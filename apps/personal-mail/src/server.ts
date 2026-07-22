import { serveStatic } from '@hono/node-server/serve-static'
import { createClient } from '@libsql/client/sqlite3'
import { Hono } from 'hono'
import { z } from 'zod'
import { createSpecterApp, EventLog, type SpecterApp } from '@specter-ts/core'
import {
  createSqliteDatabaseContext,
  createSqliteReactionSchedulerLayer,
  createSpecterSqlitePersistence,
  prepareSqliteReactionScheduler,
  prepareSpecterSqlite,
} from '@specter-ts/sqlite'
import { Layer } from 'effect'

import {
  accessConfiguration,
  requestIsAuthorized,
} from './access-control.server'
import { createAiAnalyzer } from './adapters/ai.server'
import { createGmailService } from './adapters/gmail.server'
import { openApplicationDatabase } from './db/client.server'
import { createSqliteSliceStoreLayer } from './db/specter-sqlite'
import { AiAnalyzer } from './features/mail/analyze-thread-reaction/plugin.server'
import { GmailActions } from './features/mail/apply-mailbox-action-reaction/plugin.server'
import {
  mailSpecterAppConfig,
  type MailSpecterAppConfig,
} from './features/mail/registry'

const access = accessConfiguration(process.env, import.meta.env.PROD)
const { client: sqliteClient, db, sqlitePath } = openApplicationDatabase()
const operationalClient = createClient({ url: `file:${sqlitePath}` })
await prepareSpecterSqlite(sqliteClient)
await operationalClient.execute('PRAGMA journal_mode = WAL')
await operationalClient.execute('PRAGMA busy_timeout = 5000')
await prepareSqliteReactionScheduler(operationalClient)

const gmail = createGmailService({ db })
const persistence = createSpecterSqlitePersistence(sqliteClient)
const operationalContext = createSqliteDatabaseContext(operationalClient)
const specterApp = await createSpecterApp(
  mailSpecterAppConfig,
  Layer.mergeAll(
    Layer.succeed(EventLog, persistence.eventLog),
    createSqliteReactionSchedulerLayer(operationalClient, {
      context: operationalContext,
    }),
    createSqliteSliceStoreLayer(persistence.context),
    Layer.succeed(AiAnalyzer, createAiAnalyzer()),
    Layer.succeed(GmailActions, {
      apply: (effect, deliveryId) =>
        gmail.applyMailboxAction(effect, deliveryId),
    }),
  ),
)

const analysisRequestSchema = z.object({
  threadId: z.string().min(1),
  provider: z.enum(['local', 'cloud']).default('local'),
  cloudOptIn: z.boolean().default(false),
})
const actionRequestSchema = z.object({
  threadId: z.string().min(1),
  action: z.enum(['archive', 'markRead', 'star']),
})
const ruleRequestSchema = z.object({
  name: z.string().min(1),
  senderContains: z.string().default(''),
  subjectContains: z.string().default(''),
  action: z.enum(['archive', 'markRead', 'star']),
})

const app = new Hono()

app.use('*', async (c, next) => {
  if (!requestIsAuthorized(c.req.raw, access)) {
    return c.json(
      { error: 'Personal Mail is available only to its configured owner.' },
      403,
    )
  }
  c.header('cache-control', 'no-store')
  c.header('x-content-type-options', 'nosniff')
  c.header('x-frame-options', 'DENY')
  c.header('referrer-policy', 'no-referrer')
  c.header(
    'content-security-policy',
    "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'",
  )
  await next()
})

app.get('/auth/google/start', async (c) =>
  c.redirect(await gmail.createAuthorizationUrl()),
)
app.get('/auth/google/callback', async (c) => {
  const code = c.req.query('code')
  const state = c.req.query('state')
  if (!code || !state) return c.text('Missing OAuth code or state.', 400)
  await gmail.finishAuthorization(code, state)
  void syncMailbox().catch(logBackgroundError)
  return c.redirect('/')
})

app.get('/api/status', async (c) => {
  const connection = await gmail.connectionStatus()
  return c.json({
    ...connection,
    accessMode: access.mode,
    localModel: process.env.AI_LOCAL_MODEL ?? 'llama3.2',
    cloudConfigured: Boolean(
      process.env.AI_CLOUD_BASE_URL &&
        process.env.AI_CLOUD_MODEL &&
        process.env.AI_CLOUD_API_KEY,
    ),
  })
})

app.get('/api/inbox', async (c) =>
  c.json(
    await specterApp.query({
      type: 'inboxQuery',
      payload: {
        filter: inboxFilter(c.req.query('filter')),
        search: c.req.query('search') ?? '',
      },
    }),
  ),
)

app.get('/api/rules', async (c) =>
  c.json(await specterApp.query({ type: 'rulesQuery', payload: {} })),
)

app.get('/api/activity', async (c) =>
  c.json(
    await specterApp.query({ type: 'activityQuery', payload: { limit: 30 } }),
  ),
)

app.post('/api/sync', async (c) => c.json(await syncMailbox()))

app.post('/api/analyze', async (c) => {
  const input = analysisRequestSchema.parse(await c.req.json())
  const analysisId = crypto.randomUUID()
  const execution = await specterApp.command(
    {
      type: 'requestThreadAnalysis',
      payload: {
        ...input,
        analysisId,
        requestedAt: new Date().toISOString(),
      },
    },
    { idempotencyKey: analysisId },
  )
  trackReactions(execution.reactions)
  return c.json({ analysisId }, 202)
})

app.post('/api/actions', async (c) => {
  const input = actionRequestSchema.parse(await c.req.json())
  const actionId = crypto.randomUUID()
  const execution = await specterApp.command(
    {
      type: 'requestMailboxAction',
      payload: {
        ...input,
        actionId,
        source: 'manual',
        authorizedByRuleId: null,
        requestedAt: new Date().toISOString(),
      },
    },
    { idempotencyKey: actionId },
  )
  trackReactions(execution.reactions)
  return c.json({ actionId }, 202)
})

app.post('/api/rules', async (c) => {
  const input = ruleRequestSchema.parse(await c.req.json())
  const ruleId = crypto.randomUUID()
  const execution = await specterApp.command(
    {
      type: 'createAutomationRule',
      payload: {
        ...input,
        ruleId,
        enabled: true,
        createdAt: new Date().toISOString(),
      },
    },
    { idempotencyKey: ruleId },
  )
  trackReactions(execution.reactions)
  const scheduled = await evaluateAutomations(specterApp)
  return c.json({ ruleId, scheduled }, 201)
})

app.use('/static/*', serveStatic({ root: './dist' }))
app.get('*', (c) => c.html(renderShell()))

app.onError((cause, c) => {
  console.error(
    '[personal-mail]',
    cause instanceof Error ? cause.message : cause,
  )
  const message =
    cause instanceof z.ZodError
      ? 'Request validation failed.'
      : 'Unexpected server error.'
  return c.json({ error: message }, cause instanceof z.ZodError ? 400 : 500)
})

let activeSync: Promise<{ imported: number; automations: number }> | undefined

function syncMailbox() {
  if (activeSync) return activeSync
  activeSync = runSync().finally(() => {
    activeSync = undefined
  })
  return activeSync
}

async function runSync() {
  const threads = await gmail.sync()
  for (const thread of threads) {
    const execution = await specterApp.command(
      { type: 'recordGmailThread', payload: thread },
      { idempotencyKey: `gmail:${thread.threadId}:${thread.historyId}` },
    )
    trackReactions(execution.reactions)
  }

  const inbox = await specterApp.query({
    type: 'inboxQuery',
    payload: { filter: 'all', search: '' },
  })
  for (const thread of inbox) {
    if (thread.analysis) continue
    const analysisId = `local:${thread.threadId}:${thread.historyId}`
    const execution = await specterApp.command(
      {
        type: 'requestThreadAnalysis',
        payload: {
          analysisId,
          threadId: thread.threadId,
          provider: 'local',
          cloudOptIn: false,
          requestedAt: new Date().toISOString(),
        },
      },
      { idempotencyKey: analysisId },
    )
    trackReactions(execution.reactions)
  }

  return {
    imported: threads.length,
    automations: await evaluateAutomations(specterApp),
  }
}

async function evaluateAutomations(runtime: SpecterApp<MailSpecterAppConfig>) {
  const [rules, threads] = await Promise.all([
    runtime.query({ type: 'rulesQuery', payload: {} }),
    runtime.query({
      type: 'inboxQuery',
      payload: { filter: 'all', search: '' },
    }),
  ])
  let scheduled = 0
  for (const rule of rules.filter((candidate) => candidate.enabled)) {
    for (const thread of threads) {
      if (!matchesRule(rule, thread)) continue
      const actionId = `rule:${rule.ruleId}:${thread.threadId}:${thread.historyId}:${rule.action}`
      const execution = await runtime.command(
        {
          type: 'requestMailboxAction',
          payload: {
            actionId,
            threadId: thread.threadId,
            action: rule.action,
            source: 'automation',
            authorizedByRuleId: rule.ruleId,
            requestedAt: new Date().toISOString(),
          },
        },
        { idempotencyKey: actionId },
      )
      if (!execution.duplicate) scheduled += 1
      trackReactions(execution.reactions)
    }
  }
  return scheduled
}

function matchesRule(
  rule: Awaited<ReturnType<typeof rules>>[number],
  thread: Awaited<ReturnType<typeof inbox>>[number],
) {
  const senderMatches =
    !rule.senderContains ||
    thread.sender.toLowerCase().includes(rule.senderContains.toLowerCase())
  const subjectMatches =
    !rule.subjectContains ||
    thread.subject.toLowerCase().includes(rule.subjectContains.toLowerCase())
  return senderMatches && subjectMatches
}

async function rules() {
  return specterApp.query({ type: 'rulesQuery', payload: {} })
}

async function inbox() {
  return specterApp.query({
    type: 'inboxQuery',
    payload: { filter: 'all', search: '' },
  })
}

function trackReactions(reactions: Promise<void>) {
  void reactions.catch(logBackgroundError)
}

function inboxFilter(value: string | undefined): 'all' | 'unread' | 'high' {
  return value === 'unread' || value === 'high' ? value : 'all'
}

function logBackgroundError(cause: unknown) {
  console.error(
    '[personal-mail background]',
    cause instanceof Error ? cause.message : cause,
  )
}

const syncInterval = Number(
  process.env.SPECTER_MAIL_SYNC_INTERVAL_MS ?? 300_000,
)
if (Number.isFinite(syncInterval) && syncInterval >= 60_000) {
  setInterval(() => {
    void gmail
      .connectionStatus()
      .then((status) => (status.connected ? syncMailbox() : undefined))
      .catch(logBackgroundError)
  }, syncInterval).unref()
}

function renderShell() {
  const clientScript = import.meta.env.PROD
    ? '/static/client.js'
    : '/src/client.ts'
  const stylesheet = import.meta.env.PROD
    ? '/static/assets/client.css'
    : '/src/styles.css'
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Personal Mail</title>
    <link rel="stylesheet" href="${stylesheet}" />
    <script type="module" src="${clientScript}"></script>
  </head>
  <body><div id="app"><p class="loading">Loading Personal Mail…</p></div></body>
</html>`
}

export default app

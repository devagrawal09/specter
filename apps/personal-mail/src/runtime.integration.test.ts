import { chmodSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createClient } from '@libsql/client/sqlite3'
import { drizzle } from 'drizzle-orm/libsql/sqlite3'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { Effect } from 'effect'
import { afterEach, expect, test, vi } from 'vitest'

import { gmailCredentials } from './db/adapter-schema'
import { openApplicationDatabase } from './db/client.server'
import * as schema from './db/schema'
import { createPersonalMailRuntime } from './runtime.server'

const cleanup: (() => Promise<void> | void)[] = []

afterEach(async () => {
  for (const run of cleanup.splice(0).reverse()) await run()
})

test('refuses to change permissions on an existing shared database directory', () => {
  const directory = mkdtempSync(join(tmpdir(), 'personal-mail-shared-'))
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }))
  chmodSync(directory, 0o755)

  expect(() =>
    openApplicationDatabase(join(directory, 'personal-mail.db')),
  ).toThrow('Personal Mail database directory must be owner-only')
})

test('delivers a Gmail action outside the Slice transaction and advances its cursor', async () => {
  const database = await testDatabase(true)
  const gmailFetch = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/modify')) {
        expect(init?.method).toBe('POST')
        return Response.json({
          id: 'thread-1',
          historyId: '102',
          messages: [],
        })
      }
      throw new Error(`Unexpected Gmail request: ${url}`)
    },
  )
  const runtime = await createPersonalMailRuntime({
    sqlitePath: database.path,
    gmailFetch,
    aiAnalyzer: successfulAnalyzer(),
    outboxPollIntervalMs: 10,
    outboxWorker: {
      maxAttempts: 2,
      leaseMs: 1_000,
      backoffMs: () => 1,
    },
  })
  cleanup.push(() => runtime.close())

  await recordThread(runtime.app)
  const execution = await runtime.app.command(
    {
      type: 'requestMailboxAction',
      payload: {
        actionId: 'action-1',
        threadId: 'thread-1',
        action: 'archive',
        source: 'manual',
        authorizedByRuleId: null,
        requestedAt: '2026-07-25T12:00:00.000Z',
      },
    },
    { idempotencyKey: 'action-1' },
  )
  await execution.reactions

  const activity = await waitFor(async () => {
    const rows = await runtime.app.query({
      type: 'activityQuery',
      payload: { limit: 10 },
    })
    return rows.find((row) => row.activityId === 'action:action-1')
  })
  expect(activity.status).toBe('applied')
  expect(gmailFetch).toHaveBeenCalledOnce()

  const completed = await Effect.runPromise(runtime.outbox.list('completed'))
  expect(
    completed.some(
      (job) =>
        job.payload.output.type === 'applyMailboxAction' &&
        job.payload.output.payload.actionId === 'action-1',
    ),
  ).toBe(true)

  const verification = createClient({ url: `file:${database.path}` })
  cleanup.push(() => verification.close())
  const cursor = await verification.execute({
    sql: `SELECT last_applied_order FROM slice_cursors
      WHERE slice_name = 'applyMailboxActionReaction'`,
    args: [],
  })
  expect(Number(cursor.rows[0]?.last_applied_order)).toBeGreaterThanOrEqual(
    execution.version,
  )
})

test('dead-letters failed analysis, allows later work, and retries after restart', async () => {
  const database = await testDatabase()
  let analysisFails = true
  const runtimeOptions = {
    sqlitePath: database.path,
    aiAnalyzer: {
      async analyze() {
        if (analysisFails) throw new Error('Local model is unavailable')
        return {
          summary: 'Recovered analysis.',
          priority: 'normal' as const,
          suggestedAction: 'none' as const,
        }
      },
    },
    gmailActions: {
      async apply() {
        return { status: 'applied' as const, gmailHistoryId: '103' }
      },
    },
    outboxPollIntervalMs: 10,
    outboxWorker: {
      maxAttempts: 1,
      leaseMs: 1_000,
      backoffMs: () => 1,
    },
  }
  let runtime = await createPersonalMailRuntime(runtimeOptions)
  cleanup.push(() => runtime.close())

  await recordThread(runtime.app)
  const analysis = await runtime.app.command(
    {
      type: 'requestThreadAnalysis',
      payload: {
        analysisId: 'analysis-1',
        threadId: 'thread-1',
        provider: 'local',
        cloudOptIn: false,
        requestedAt: '2026-07-25T12:00:00.000Z',
      },
    },
    { idempotencyKey: 'analysis-1' },
  )
  await analysis.reactions

  const deadLetter = await waitFor(async () => {
    const jobs = await Effect.runPromise(runtime.outbox.list('dead-letter'))
    return jobs.find(
      (job) =>
        job.payload.output.type === 'analyzeThread' &&
        job.payload.output.payload.analysisId === 'analysis-1',
    )
  })

  const action = await runtime.app.command(
    {
      type: 'requestMailboxAction',
      payload: {
        actionId: 'action-after-failure',
        threadId: 'thread-1',
        action: 'star',
        source: 'manual',
        authorizedByRuleId: null,
        requestedAt: '2026-07-25T12:01:00.000Z',
      },
    },
    { idempotencyKey: 'action-after-failure' },
  )
  await action.reactions
  await waitFor(async () => {
    const rows = await runtime.app.query({
      type: 'activityQuery',
      payload: { limit: 10 },
    })
    return rows.find(
      (row) =>
        row.activityId === 'action:action-after-failure' &&
        row.status === 'applied',
    )
  })

  await runtime.close()
  analysisFails = false
  runtime = await createPersonalMailRuntime(runtimeOptions)
  const persistedDeadLetter = await Effect.runPromise(
    runtime.outbox.get(deadLetter.id),
  )
  expect(persistedDeadLetter?.status).toBe('dead-letter')
  await Effect.runPromise(
    runtime.outbox.retryDeadLetter(deadLetter.id, new Date()),
  )
  const thread = await waitFor(async () => {
    const inbox = await runtime.app.query({
      type: 'inboxQuery',
      payload: { filter: 'all', search: '' },
    })
    return inbox[0]?.analysis ? inbox[0] : undefined
  })
  expect(thread.analysis?.summary).toBe('Recovered analysis.')
})

test('revoking a rule prevents its queued action from reaching Gmail', async () => {
  const database = await testDatabase()
  const gmailFetch = vi.fn()
  const runtime = await createPersonalMailRuntime({
    sqlitePath: database.path,
    aiAnalyzer: successfulAnalyzer(),
    gmailFetch,
    outboxPollIntervalMs: 1_000,
    outboxWorker: {
      maxAttempts: 1,
      leaseMs: 2_000,
      backoffMs: () => 1,
    },
  })
  cleanup.push(() => runtime.close())

  await recordThread(runtime.app)
  await runtime.app.command(
    {
      type: 'createAutomationRule',
      payload: {
        ruleId: 'rule-1',
        name: 'Archive Ada',
        senderContains: 'ada@example.com',
        subjectContains: '',
        action: 'archive',
        enabled: true,
        createdAt: '2026-07-25T12:00:00.000Z',
      },
    },
    { idempotencyKey: 'rule-1' },
  )
  const request = await runtime.app.command(
    {
      type: 'requestMailboxAction',
      payload: {
        actionId: 'rule-action-1',
        threadId: 'thread-1',
        action: 'archive',
        source: 'automation',
        authorizedByRuleId: 'rule-1',
        requestedAt: '2026-07-25T12:01:00.000Z',
      },
    },
    { idempotencyKey: 'rule-action-1' },
  )
  await request.reactions
  await runtime.app.command(
    {
      type: 'changeAutomationRuleEnabled',
      payload: {
        ruleId: 'rule-1',
        enabled: false,
        changedAt: '2026-07-25T12:02:00.000Z',
      },
    },
    { idempotencyKey: 'disable-rule-1' },
  )

  const failed = await waitFor(async () => {
    const rows = await runtime.app.query({
      type: 'activityQuery',
      payload: { limit: 10 },
    })
    return rows.find(
      (row) =>
        row.activityId === 'action:rule-action-1' && row.status === 'failed',
    )
  }, 3_000)
  expect(failed.detail).toContain('Automation authority was revoked')
  expect(gmailFetch).not.toHaveBeenCalled()
})

async function testDatabase(connected = false) {
  const directory = mkdtempSync(join(tmpdir(), 'personal-mail-runtime-'))
  const path = join(directory, 'runtime.db')
  const client = createClient({ url: `file:${path}` })
  const db = drizzle(client, { schema })
  await migrate(db, { migrationsFolder: join(process.cwd(), 'drizzle') })
  if (connected) {
    await db
      .insert(gmailCredentials)
      .values({
        account: 'me',
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        expiresAt: Date.now() + 3_600_000,
        email: 'owner@example.com',
      })
      .run()
  }
  client.close()
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }))
  return { path }
}

function successfulAnalyzer() {
  return {
    async analyze() {
      return {
        summary: 'Needs review.',
        priority: 'high' as const,
        suggestedAction: 'reply' as const,
      }
    },
  }
}

async function recordThread(
  app: Awaited<ReturnType<typeof createPersonalMailRuntime>>['app'],
) {
  const execution = await app.command(
    {
      type: 'recordGmailThread',
      payload: {
        threadId: 'thread-1',
        messageId: 'message-1',
        historyId: '101',
        sender: 'Ada <ada@example.com>',
        subject: 'Review',
        snippet: 'Please review.',
        bodyText: 'Please review the build.',
        receivedAt: '2026-07-25T11:00:00.000Z',
        unread: true,
        labels: ['INBOX', 'UNREAD'],
      },
    },
    { idempotencyKey: 'gmail:thread-1:101' },
  )
  await execution.reactions
}

async function waitFor<T>(
  read: () => Promise<T | undefined>,
  timeoutMs = 2_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await read()
    if (value !== undefined) return value
    if (Date.now() >= deadline) throw new Error('Timed out waiting for state')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

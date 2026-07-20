import { serveStatic } from '@hono/node-server/serve-static'
import { Hono, type Context } from 'hono'
import { existsSync, renameSync } from 'node:fs'
import { z } from 'zod'
import {
  buildLanternDungeonMasterInstructions,
  lanternRealtimeTools,
  realtimeModel,
} from './dungeon-master.server'
import { createLastLanternRuntime } from './last-lantern-runtime.server'
import './styles.css?url'

let runtime = await createLastLanternRuntime()
const app = new Hono()
const isoNow = () => new Date().toISOString()

const heroNameInput = z.object({ name: z.string().min(1).max(40) }).strict()
const approachInput = z
  .object({ approach: z.enum(['gentle', 'bold', 'cunning']) })
  .strict()
const resolveRollInput = z
  .object({
    rollId: z.string().min(1),
    faces: z.array(z.number().int()).length(1),
  })
  .strict()
const fateInput = z
  .object({ fate: z.enum(['free', 'bind', 'befriend']) })
  .strict()
const speechInput = z
  .object({
    utteranceId: z.string().min(1),
    role: z.enum(['player', 'dungeon-master']),
    text: z.string().min(1).max(4_000),
  })
  .strict()
const resetInput = z
  .object({ confirm: z.literal('RESET LAST LANTERN') })
  .strict()

app.get('/api/health', (c) =>
  c.json({
    ok: true,
    model: realtimeModel,
    apiKeyConfigured: Boolean(process.env.OPENAI_API_KEY),
  }),
)
app.get('/api/lantern/state', async (c) => c.json(await tableState()))

app.post('/api/lantern/reset', async (c) => {
  resetInput.parse(await c.req.json())
  const state = await tableState()
  if (state.stage !== 'complete')
    return c.json(
      { error: 'The test can only be reset after reaching an ending.' },
      409,
    )
  const sqlitePath = runtime.sqlitePath
  await runtime.close()
  const backupSuffix = `.completed-${Date.now()}.bak`
  for (const suffix of ['', '-wal', '-shm']) {
    const source = `${sqlitePath}${suffix}`
    if (existsSync(source)) renameSync(source, `${source}${backupSuffix}`)
  }
  runtime = await createLastLanternRuntime(sqlitePath)
  return c.json({ state: await tableState() })
})

app.post('/api/lantern/start', async (c) =>
  execute(c, {
    type: 'beginLanternTest',
    payload: { startedAt: isoNow() },
  }),
)
app.post('/api/lantern/name', async (c) => {
  const input = heroNameInput.parse(await c.req.json())
  return execute(c, {
    type: 'nameLanternHero',
    payload: { ...input, namedAt: isoNow() },
  })
})
app.post('/api/lantern/approach', async (c) => {
  const input = approachInput.parse(await c.req.json())
  return execute(c, {
    type: 'approachEmberSpirit',
    payload: { ...input, rollId: crypto.randomUUID(), chosenAt: isoNow() },
  })
})
app.post('/api/lantern/roll/confirm', async (c) => {
  const input = resolveRollInput.parse(await c.req.json())
  const state = await tableState()
  const nextRollId =
    state.pendingRoll?.challenge === 'read-runes' ? crypto.randomUUID() : null
  return execute(c, {
    type: 'resolveLanternRoll',
    payload: { ...input, nextRollId, confirmedAt: isoNow() },
  })
})
app.post('/api/lantern/checkpoint/recovered', async (c) =>
  execute(c, {
    type: 'recoverLanternCheckpoint',
    payload: { recoveredAt: isoNow() },
  }),
)
app.post('/api/lantern/fate', async (c) => {
  const input = fateInput.parse(await c.req.json())
  return execute(c, {
    type: 'chooseEmberFate',
    payload: { ...input, chosenAt: isoNow() },
  })
})
app.post('/api/lantern/speech', async (c) => {
  const input = speechInput.parse(await c.req.json())
  return execute(c, {
    type: 'recordLanternSpeech',
    payload: { ...input, spokenAt: isoNow() },
  })
})

app.post('/api/realtime/session', async (c) => {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey)
    return c.json(
      { error: 'OPENAI_API_KEY is not configured. Use Demo Mode instead.' },
      503,
    )
  const sdp = await c.req.text()
  if (!sdp.trim())
    return c.json({ error: 'Missing WebRTC session description.' }, 400)
  const form = new FormData()
  form.set('sdp', sdp)
  form.set(
    'session',
    JSON.stringify({
      type: 'realtime',
      model: realtimeModel,
      output_modalities: ['audio'],
      instructions: buildLanternDungeonMasterInstructions(),
      audio: { input: { turn_detection: null }, output: { voice: 'marin' } },
      tools: lanternRealtimeTools,
      tool_choice: 'auto',
    }),
  )
  const response = await fetch('https://api.openai.com/v1/realtime/calls', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'OpenAI-Safety-Identifier': 'local-last-lantern-player',
    },
    body: form,
  })
  const body = await response.text()
  if (!response.ok)
    return c.json(
      { error: body || 'OpenAI Realtime session creation failed.' },
      502,
    )
  return c.body(body, 200, { 'Content-Type': 'application/sdp' })
})

app.use('/static/*', serveStatic({ root: './dist' }))
app.use('/art/*', serveStatic({ root: './public' }))
app.get('*', (c) => c.html(renderShell()))

async function tableState() {
  return runtime.app.query({ type: 'lanternTableQuery', payload: {} })
}

type LanternCommandEnvelope = Parameters<typeof runtime.app.command>[0]

async function execute(c: Context, envelope: LanternCommandEnvelope) {
  try {
    const execution = await runtime.app.command(envelope, {
      idempotencyKey: c.req.header('x-idempotency-key') ?? crypto.randomUUID(),
    })
    await execution.reactions
    return c.json({ state: await tableState(), duplicate: execution.duplicate })
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    return c.json({ error: message }, 400)
  }
}

function renderShell() {
  const clientScript = import.meta.env.PROD
    ? '/static/client.js'
    : '/src/client.tsx'
  const stylesheet = import.meta.env.PROD
    ? '/static/assets/client.css'
    : '/src/styles.css'
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="theme-color" content="#071116" /><title>The Last Lantern</title>
<link rel="stylesheet" href="${stylesheet}" /><script type="module" src="${clientScript}"></script>
</head><body><div id="app"></div></body></html>`
}

let shutdownPromise: Promise<void> | undefined
const shutdown = (serverClosed: Promise<unknown> = Promise.resolve()) => {
  shutdownPromise ??= (async () => {
    await serverClosed
    await runtime.close()
  })()
  return shutdownPromise
}
;(globalThis as Record<symbol, unknown>)[Symbol.for('last-lantern.shutdown')] =
  shutdown

export default app

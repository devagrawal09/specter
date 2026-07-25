import { serveStatic } from '@hono/node-server/serve-static'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, renameSync } from 'node:fs'
import { Hono, type Context } from 'hono'
import { z, ZodError } from 'zod'

import {
  buildLanternDungeonMasterInstructions,
  lanternRealtimeTools,
  realtimeModel,
} from './dungeon-master.server'
import { createLastLanternRuntime } from './last-lantern-runtime.server'

const commandAt = z.string().datetime({ offset: true })
const idempotencyKey = z.string().min(1).max(200)
const heroNameInput = z.object({ name: z.string().min(1).max(40) }).strict()
const approachInput = z
  .object({ approach: z.enum(['gentle', 'bold', 'cunning']) })
  .strict()
const resolveRollInput = z
  .object({
    rollId: z.string().min(1).max(200),
    challenge: z.enum(['read-runes', 'catch-ember']),
    faces: z.array(z.number().int()).length(1),
  })
  .strict()
const fateInput = z
  .object({ fate: z.enum(['free', 'bind', 'befriend']) })
  .strict()
const speechInput = z
  .object({
    utteranceId: z.string().min(1).max(200),
    role: z.enum(['player', 'dungeon-master']),
    text: z.string().min(1).max(4_000),
  })
  .strict()
const resetInput = z
  .object({ confirm: z.literal('RESET LAST LANTERN') })
  .strict()

export const realtimeInputTranscriptionModel = 'gpt-4o-mini-transcribe'

export function createLanternRealtimeSessionConfig() {
  return {
    type: 'realtime',
    model: realtimeModel,
    output_modalities: ['audio'],
    instructions: buildLanternDungeonMasterInstructions(),
    audio: {
      input: {
        turn_detection: null,
        transcription: {
          model: realtimeInputTranscriptionModel,
          language: 'en',
        },
      },
      output: { voice: 'marin' },
    },
    tools: lanternRealtimeTools,
    tool_choice: 'auto',
  } as const
}

type LastLanternRuntime = Awaited<ReturnType<typeof createLastLanternRuntime>>

export type LastLanternServerOptions = {
  readonly sqlitePath?: string
  readonly createRuntime?: (sqlitePath?: string) => Promise<LastLanternRuntime>
  readonly realtimeFetch?: typeof fetch
  readonly realtimeApiKey?: () => string | undefined
  readonly now?: () => Date
}

export async function createLastLanternServer(
  options: LastLanternServerOptions = {},
) {
  const runtimeFactory = options.createRuntime ?? createLastLanternRuntime
  const realtimeFetch = options.realtimeFetch ?? fetch
  const realtimeApiKey =
    options.realtimeApiKey ?? (() => process.env.OPENAI_API_KEY)
  const now = options.now ?? (() => new Date())
  let runtime = await runtimeFactory(options.sqlitePath)
  let closed = false
  const serialize = createSerialGate()
  const app = new Hono()

  app.onError((cause, c) => {
    if (cause instanceof ZodError || cause instanceof SyntaxError) {
      return c.json({ error: 'Invalid request body.' }, 400)
    }
    if (cause instanceof LanternHttpError) {
      return c.json({ error: cause.message }, cause.status)
    }
    console.error('Last Lantern request failed.', cause)
    return c.json({ error: 'The Last Lantern request failed.' }, 500)
  })

  app.get('/api/health', (c) =>
    c.json({
      ok: true,
      model: realtimeModel,
      apiKeyConfigured: Boolean(realtimeApiKey()),
    }),
  )
  app.get('/api/lantern/state', async (c) =>
    c.json(await serialize(tableStateUnlocked)),
  )

  app.post('/api/lantern/reset', async (c) => {
    resetInput.parse(await c.req.json())
    return serialize(async () => {
      const state = await tableStateUnlocked()
      if (state.stage !== 'complete') {
        return c.json(
          { error: 'The test can only be reset after reaching an ending.' },
          409,
        )
      }
      const sqlitePath = runtime.sqlitePath
      await runtime.close()
      const backupSuffix = `.completed-${now().getTime()}.bak`
      for (const suffix of ['', '-wal', '-shm']) {
        const source = `${sqlitePath}${suffix}`
        if (existsSync(source)) renameSync(source, `${source}${backupSuffix}`)
      }
      runtime = await runtimeFactory(sqlitePath)
      return c.json({ state: await tableStateUnlocked() })
    })
  })

  app.post('/api/lantern/start', async (c) => {
    const metadata = commandMetadata(c, now)
    return execute(
      c,
      {
        type: 'beginLanternTest',
        payload: { startedAt: metadata.initiatedAt },
      },
      metadata.idempotencyKey,
    )
  })
  app.post('/api/lantern/name', async (c) => {
    const input = heroNameInput.parse(await c.req.json())
    const metadata = commandMetadata(c, now)
    return execute(
      c,
      {
        type: 'nameLanternHero',
        payload: { ...input, namedAt: metadata.initiatedAt },
      },
      metadata.idempotencyKey,
    )
  })
  app.post('/api/lantern/approach', async (c) => {
    const input = approachInput.parse(await c.req.json())
    const metadata = commandMetadata(c, now)
    return execute(
      c,
      {
        type: 'approachEmberSpirit',
        payload: {
          ...input,
          rollId: stableId('roll-runes', metadata.idempotencyKey),
          chosenAt: metadata.initiatedAt,
        },
      },
      metadata.idempotencyKey,
    )
  })
  app.post('/api/lantern/roll/confirm', async (c) => {
    const input = resolveRollInput.parse(await c.req.json())
    const metadata = commandMetadata(c, now)
    const nextRollId =
      input.challenge === 'read-runes'
        ? stableId('roll-ember', input.rollId)
        : null
    return execute(
      c,
      {
        type: 'resolveLanternRoll',
        payload: {
          rollId: input.rollId,
          faces: input.faces,
          nextRollId,
          confirmedAt: metadata.initiatedAt,
        },
      },
      metadata.idempotencyKey,
    )
  })
  app.post('/api/lantern/checkpoint/recovered', async (c) => {
    const metadata = commandMetadata(c, now)
    return execute(
      c,
      {
        type: 'recoverLanternCheckpoint',
        payload: { recoveredAt: metadata.initiatedAt },
      },
      metadata.idempotencyKey,
    )
  })
  app.post('/api/lantern/fate', async (c) => {
    const input = fateInput.parse(await c.req.json())
    const metadata = commandMetadata(c, now)
    return execute(
      c,
      {
        type: 'chooseEmberFate',
        payload: { ...input, chosenAt: metadata.initiatedAt },
      },
      metadata.idempotencyKey,
    )
  })
  app.post('/api/lantern/speech', async (c) => {
    const input = speechInput.parse(await c.req.json())
    const metadata = commandMetadata(c, now)
    return execute(
      c,
      {
        type: 'recordLanternSpeech',
        payload: { ...input, spokenAt: metadata.initiatedAt },
      },
      metadata.idempotencyKey,
    )
  })

  app.post('/api/realtime/session', async (c) => {
    const apiKey = realtimeApiKey()
    if (!apiKey) {
      return c.json(
        { error: 'OPENAI_API_KEY is not configured. Use Demo Mode instead.' },
        503,
      )
    }
    const sdp = await c.req.text()
    if (!sdp.trim()) {
      return c.json({ error: 'Missing WebRTC session description.' }, 400)
    }
    const form = new FormData()
    form.set('sdp', sdp)
    form.set('session', JSON.stringify(createLanternRealtimeSessionConfig()))
    let response: Response
    try {
      response = await realtimeFetch(
        'https://api.openai.com/v1/realtime/calls',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'OpenAI-Safety-Identifier': 'local-last-lantern-player',
          },
          body: form,
        },
      )
    } catch {
      return c.json({ error: 'OpenAI Realtime session creation failed.' }, 502)
    }
    const body = await response.text()
    if (!response.ok) {
      return c.json({ error: 'OpenAI Realtime session creation failed.' }, 502)
    }
    return c.body(body, 200, { 'Content-Type': 'application/sdp' })
  })

  app.use('/static/*', serveStatic({ root: './dist' }))
  app.use('/art/*', serveStatic({ root: './public' }))
  app.get('*', (c) => c.html(renderShell()))

  async function tableStateUnlocked() {
    if (closed) throw new LanternHttpError(503, 'The server is shutting down.')
    return runtime.app.query({ type: 'lanternTableQuery', payload: {} })
  }

  type LanternCommandEnvelope = Parameters<typeof runtime.app.command>[0]

  async function execute(
    c: Context,
    envelope: LanternCommandEnvelope,
    requestKey: string,
  ) {
    return serialize(async () => {
      if (closed) return c.json({ error: 'The server is shutting down.' }, 503)
      try {
        const execution = await runtime.app.command(envelope, {
          idempotencyKey: requestKey,
        })
        await execution.reactions
        return c.json({
          state: await tableStateUnlocked(),
          duplicate: execution.duplicate,
        })
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause)
        return c.json({ error: message }, 400)
      }
    })
  }

  const close = () =>
    serialize(async () => {
      if (closed) return
      closed = true
      await runtime.close()
    })

  return { app, close }
}

function commandMetadata(c: Context, now: () => Date) {
  const providedKey = c.req.header('x-idempotency-key')
  const providedAt = c.req.header('x-command-at')
  if (providedKey && !providedAt) {
    throw new LanternHttpError(
      400,
      'x-command-at is required with x-idempotency-key.',
    )
  }
  return {
    idempotencyKey: idempotencyKey.parse(providedKey ?? randomUUID()),
    initiatedAt: commandAt.parse(providedAt ?? now().toISOString()),
  }
}

function stableId(prefix: string, source: string) {
  const digest = createHash('sha256').update(source).digest('hex').slice(0, 24)
  return `${prefix}-${digest}`
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

function createSerialGate() {
  let tail: Promise<void> = Promise.resolve()
  return async <T>(run: () => Promise<T>) => {
    const previous = tail
    let release: () => void = () => undefined
    tail = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      return await run()
    } finally {
      release()
    }
  }
}

class LanternHttpError extends Error {
  constructor(
    readonly status: 400 | 503,
    message: string,
  ) {
    super(message)
  }
}

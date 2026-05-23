import { serveStatic } from '@hono/node-server/serve-static'
import { Effect } from 'effect'
import { Hono } from 'hono'

import { todoSqlRegistrations } from './features/todos-sql/registry'
import { createRegistry, createRegistryRuntimeLayer } from './lib2'
import './styles.css?url'

const registry = Effect.runSync(createRegistry(todoSqlRegistrations))
const runtimeLayer = createRegistryRuntimeLayer({ sqliteFilename: './data/app.db' })
let reactionQueueRunning = false
let reactionQueueRequested = false

type ApiError = {
  ok: false
  code: 'BAD_REQUEST' | 'NOT_FOUND' | 'INTERNAL_ERROR'
  message: string
}

const app = new Hono()

const routes = app
  .get('/api/projection', async (c) => {
    const rawInput = c.req.query('input')
    const parsedInput = rawInput ? safeJsonParse(rawInput) : {}

    try {
      const data = await Effect.runPromise(
        registry
          .query(c.req.query('projectionName') ?? '', parsedInput)
          .pipe(Effect.provide(runtimeLayer)),
      )

      return c.json({
        ok: true as const,
        data,
      })
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Projection failed'

      return c.json(
        error('INTERNAL_ERROR', message),
        500,
      )
    }
  })
  .post('/api/command', async (c) => {
    const command = await c.req.json().catch(() => null)

    try {
      await Effect.runPromise(
        registry
          .dispatch({
            type:
              command && typeof command === 'object' && 'type' in command
                ? String(command.type)
                : '',
            payload:
              command && typeof command === 'object' && 'payload' in command
                ? command.payload
                : undefined,
          })
          .pipe(Effect.provide(runtimeLayer)),
      )
      startReactionQueue()

      return c.json({ ok: true as const })
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Command failed'
      return c.json(error('INTERNAL_ERROR', message), 500)
    }
  })

app.use('/static/*', serveStatic({ root: './dist' }))
app.get('/manifest.json', serveStatic({ path: './public/manifest.json' }))
app.get('/favicon.ico', serveStatic({ path: './public/favicon.ico' }))

app.get('*', (c) => c.html(renderShell()))

function error(code: ApiError['code'], message: string): ApiError {
  return { ok: false, code, message }
}

function safeJsonParse(value: string) {
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

function startReactionQueue() {
  reactionQueueRequested = true

  if (reactionQueueRunning) {
    return
  }

  reactionQueueRunning = true
  void drainReactionQueue()
}

async function drainReactionQueue() {
  try {
    while (reactionQueueRequested) {
      reactionQueueRequested = false

      while (
        await Effect.runPromise(
          registry.runReactions().pipe(Effect.provide(runtimeLayer)),
        )
      ) {
        // Reactions can dispatch commands that produce more reaction work.
      }
    }
  } catch (cause) {
    console.error('Reaction queue failed', cause)
  } finally {
    reactionQueueRunning = false

    if (reactionQueueRequested) {
      startReactionQueue()
    }
  }
}

function renderShell() {
  const clientScript = import.meta.env.PROD
    ? '/static/client.js'
    : '/src/client.tsx'
  const stylesheet = import.meta.env.PROD
    ? '/static/assets/client.css'
    : '/src/styles.css'

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Specter Todos</title>
    <link rel="stylesheet" href="${stylesheet}" />
    <script type="module" src="${clientScript}"></script>
  </head>
  <body>
    <div id="app"></div>
  </body>
</html>`
}

export type AppType = typeof routes
export default app

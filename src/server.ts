import { serveStatic } from '@hono/node-server/serve-static'
import { Effect } from 'effect'
import { Hono } from 'hono'

import { todoSpecterAppConfig } from './features/todos/registry'
import { createSpecterApp, createSpecterAppRuntimeLayer } from './lib'
import './styles.css?url'

const specterApp = Effect.runSync(createSpecterApp(todoSpecterAppConfig))
const runtimeLayer = createSpecterAppRuntimeLayer({
  sqliteFilename: './data/app.db',
})
let reactionQueueRunning = false
let reactionQueueRequested = false

type ApiError = {
  ok: false
  code: 'BAD_REQUEST' | 'NOT_FOUND' | 'INTERNAL_ERROR'
  message: string
}

const app = new Hono()

const routes = app
  .get('/api/query', async (c) => {
    const rawInput = c.req.query('input')
    const parsedInput = rawInput ? safeJsonParse(rawInput) : {}

    const response = await Effect.runPromise(
      specterApp.query(c.req.query('queryName') ?? '', parsedInput).pipe(
        Effect.provide(runtimeLayer),
        Effect.map((data) => ({
          body: { ok: true as const, data },
          status: 200 as const,
        })),
        Effect.catchTags({
          InvalidQueryInputError: (cause: { message: string }) =>
            Effect.succeed({
              body: error('BAD_REQUEST', cause.message),
              status: 400 as const,
            }),
          UnknownQueryError: (cause: { message: string }) =>
            Effect.succeed({
              body: error('NOT_FOUND', cause.message),
              status: 404 as const,
            }),
        }),
        Effect.catchAll((cause) =>
          Effect.succeed({
            body: error(
              'INTERNAL_ERROR',
              cause instanceof Error ? cause.message : 'Query failed',
            ),
            status: 500 as const,
          }),
        ),
      ),
    )

    return c.json(response.body, response.status)
  })
  .post('/api/command', async (c) => {
    const command = await c.req.json().catch(() => null)

    const response = await Effect.runPromise(
      specterApp
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
        .pipe(
          Effect.provide(runtimeLayer),
          Effect.as({ body: { ok: true as const }, status: 200 as const }),
          Effect.catchTags({
            CommandRejectedError: (cause: { reason: string }) =>
              Effect.succeed({
                body: error('BAD_REQUEST', cause.reason),
                status: 400 as const,
              }),
            InvalidCommandError: (cause: { message: string }) =>
              Effect.succeed({
                body: error('BAD_REQUEST', cause.message),
                status: 400 as const,
              }),
            UnknownCommandError: (cause: { message: string }) =>
              Effect.succeed({
                body: error('NOT_FOUND', cause.message),
                status: 404 as const,
              }),
          }),
          Effect.catchAll((cause) =>
            Effect.succeed({
              body: error(
                'INTERNAL_ERROR',
                cause instanceof Error ? cause.message : 'Command failed',
              ),
              status: 500 as const,
            }),
          ),
        ),
    )

    if (response.status === 200) {
      setTimeout(startReactionQueue, 0)
    }

    return c.json(response.body, response.status)
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
          specterApp.runReactions().pipe(Effect.provide(runtimeLayer)),
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
      void startReactionQueue()
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

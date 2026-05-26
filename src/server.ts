import { serveStatic } from '@hono/node-server/serve-static'
import { Etag } from '@effect/platform'
import { NodeContext, NodeHttpPlatform } from '@effect/platform-node'
import { RpcSerialization, RpcServer } from '@effect/rpc'
import { Effect, Layer } from 'effect'
import { Hono } from 'hono'

import { todoSpecterAppConfig } from './features/todos/registry'
import { createSpecterApp, createSpecterAppRuntimeLayer } from './lib'
import { specterRpcGroup } from './lib/client'
import './styles.css?url'

const specterApp = Effect.runSync(createSpecterApp(todoSpecterAppConfig))
const runtimeLayer = createSpecterAppRuntimeLayer({
  sqliteFilename: './data/app.db',
})
let reactionQueueRunning = false
let reactionQueueRequested = false

const app = new Hono()

const rpcHandlers = specterRpcGroup.toLayer({
  Dispatch: ({ commandName, payload }) =>
    specterApp.dispatch({ type: commandName, payload }).pipe(
      Effect.provide(runtimeLayer),
      Effect.tap(() => Effect.sync(startReactionQueue)),
      Effect.catchTags({
        CommandRejectedError: (cause: { reason: string }) =>
          Effect.fail(cause.reason),
        InvalidCommandError: (cause: { message: string }) =>
          Effect.fail(cause.message),
        UnknownCommandError: (cause: { message: string }) =>
          Effect.fail(cause.message),
      }),
      Effect.catchAll((cause) => Effect.fail(messageFromCause(cause))),
    ),
  Query: ({ queryName, input }) =>
    specterApp.query(queryName, input).pipe(
      Effect.provide(runtimeLayer),
      Effect.catchTags({
        InvalidQueryInputError: (cause: { message: string }) =>
          Effect.fail(cause.message),
        UnknownQueryError: (cause: { message: string }) =>
          Effect.fail(cause.message),
      }),
      Effect.catchAll((cause) => Effect.fail(messageFromCause(cause))),
    ),
})

const rpcWebHandler = RpcServer.toWebHandler(specterRpcGroup, {
  layer: Layer.mergeAll(
    rpcHandlers,
    RpcSerialization.layerNdjson,
    NodeContext.layer,
    NodeHttpPlatform.layer,
    Etag.layer,
  ),
})

const routes = app.all('/rpc', (c) => rpcWebHandler.handler(c.req.raw))

app.use('/static/*', serveStatic({ root: './dist' }))
app.get('/manifest.json', serveStatic({ path: './public/manifest.json' }))
app.get('/favicon.ico', serveStatic({ path: './public/favicon.ico' }))

app.get('*', (c) => c.html(renderShell()))

function messageFromCause(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause)
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
    <title>Specter</title>
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

import { serveStatic } from '@hono/node-server/serve-static'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { createClient } from '@libsql/client/sqlite3'
import { drizzle } from 'drizzle-orm/libsql'
import { Hono } from 'hono'
import { createSpecterApp } from '@specter-ts/core'

import { runWithSqliteDb } from './db/specter-sqlite'
import { todoSpecterAppConfig } from './features/todos/registry'
import * as schema from './db/schema'
import './styles.css?url'

const sqlitePath = process.env.SPECTER_SQLITE_PATH ?? './data/app.db'
mkdirSync(dirname(sqlitePath), { recursive: true })
const productionDb = drizzle(createClient({ url: `file:${sqlitePath}` }), {
  schema,
})
const specterApp = createSpecterApp(todoSpecterAppConfig)
const queryMethods: ReadonlySet<string> = new Set(
  todoSpecterAppConfig.slices
    .filter((slice) => slice.kind === 'query')
    .map((slice) => slice.name),
)
let reactionQueueRunning = false
let reactionQueueRequested = false

const app = new Hono()

app.post('/api/:method', async (c) => {
  const method = c.req.param('method')
  const body = (await c.req.json().catch(() => ({}))) as unknown
  const operation = (specterApp as Record<string, unknown>)[method]

  if (typeof operation !== 'function') {
    return c.json({ error: `Unknown operation: ${method}` }, 404)
  }

  try {
    const result = await runWithSqliteDb(productionDb, () => operation(body))

    if (!queryMethods.has(method)) startReactionQueue()

    return c.json(result ?? null)
  } catch (cause) {
    return c.json({ error: messageFromCause(cause) }, 400)
  }
})

const routes = app

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
    await runWithSqliteDb(productionDb, async () => {
      while (reactionQueueRequested) {
        reactionQueueRequested = false

        while (await specterApp.runtime.runReactions()) {
          // Reactions can dispatch commands that produce more reaction work.
        }
      }
    })
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

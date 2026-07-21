import { serveStatic } from '@hono/node-server/serve-static'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { createClient } from '@libsql/client/sqlite3'
import { drizzle } from 'drizzle-orm/libsql/sqlite3'
import { Hono } from 'hono'
import { createSpecterApp } from '@specter-ts/core'
import {
  createRuntimeObservationEmitter,
  createRuntimeObservationProducer,
} from '@specter-ts/observability'
import {
  createSpecterProtocolHttpHandler,
  createSpecterRuntimeProtocolAdapter,
  type RuntimeSource,
} from '@specter-ts/protocol'
import {
  createDurableReactionScheduler,
  type ReactionPass,
} from '@specter-ts/reaction-outbox'
import {
  createSqliteDatabaseContext,
  createSqliteReactionOutboxStore,
  createSpecterSqlitePersistence,
  prepareSqliteReactionOutbox,
  prepareSpecterSqlite,
} from '@specter-ts/sqlite'

import { runWithSqliteDb } from './db/specter-sqlite'
import { createTodoSpecterAppConfig } from './features/todos/registry'
import { createSpecterHttpHandler } from './transport/specter-http.server'
import {
  createSqliteReactionTicketStore,
  prepareSqliteReactionTicketStore,
} from './transport/specter-reaction-tickets-sqlite.server'
import * as schema from './db/schema'
import './styles.css?url'

const sqlitePath = process.env.SPECTER_SQLITE_PATH ?? './data/app.db'
mkdirSync(dirname(sqlitePath), { recursive: true })
const sqliteUrl = `file:${sqlitePath}`
const sqliteClient = createClient({ url: sqliteUrl })
const operationalSqliteClient = createClient({ url: sqliteUrl })
await prepareSpecterSqlite(sqliteClient)
await operationalSqliteClient.execute('PRAGMA journal_mode = WAL')
await operationalSqliteClient.execute('PRAGMA busy_timeout = 5000')
await prepareSqliteReactionOutbox(operationalSqliteClient)
await prepareSqliteReactionTicketStore(operationalSqliteClient)
const productionDb = drizzle(sqliteClient, {
  schema,
})
const persistence = createSpecterSqlitePersistence(sqliteClient)
const operationalContext = createSqliteDatabaseContext(operationalSqliteClient)
const runtimeSource: RuntimeSource = {
  application: 'todo-reference',
  environment:
    process.env.SPECTER_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development',
  runtimeLanguage: 'typescript',
  runtimeVersion: '0.3.0',
  instanceId:
    process.env.SPECTER_INSTANCE_ID ?? `todo-reference-${process.pid}`,
  eventLogId: process.env.SPECTER_EVENT_LOG_ID ?? sqlitePath,
}
const observationProducer = createRuntimeObservationProducer({
  endpoint: process.env.SPECTER_OBSERVABILITY_URL ?? 'http://127.0.0.1:41736',
  source: runtimeSource,
})
const runtimeObservability = createRuntimeObservationEmitter({
  producer: observationProducer,
  source: runtimeSource,
})
const durableSchedule = createDurableReactionScheduler(
  createSqliteReactionOutboxStore<ReactionPass>(operationalSqliteClient, {
    context: operationalContext,
  }),
  {
    onTransition: runtimeObservability.outbox,
    onBackgroundError: (cause) =>
      console.error('Specter Reaction worker failed', cause),
  },
)
const specterApp = await createSpecterApp(
  createTodoSpecterAppConfig(
    persistence.eventLog,
    (run) =>
      durableSchedule((context) =>
        runWithSqliteDb(productionDb, () => run(context)),
      ),
    { observe: runtimeObservability.observe },
  ),
)
const handleSpecterRequest = createSpecterHttpHandler({
  app: specterApp,
  basePath: '/api',
  run: (operation) => runWithSqliteDb(productionDb, operation),
  reactionTickets: createSqliteReactionTicketStore(operationalSqliteClient, {
    context: operationalContext,
  }),
})

const app = new Hono()

const handleProtocolRequest = createSpecterProtocolHttpHandler({
  runtime: createSpecterRuntimeProtocolAdapter({
    app: specterApp,
    eventLog: persistence.eventLog,
    runtimeVersion: runtimeSource.runtimeVersion,
    run: (operation) => runWithSqliteDb(productionDb, operation),
  }),
})

app.all('/api/*', (c) => handleSpecterRequest(c.req.raw))
app.all('/specter/v1/*', (c) => handleProtocolRequest(c.req.raw))

const routes = app

app.use('/static/*', serveStatic({ root: './dist' }))
app.get('/manifest.json', serveStatic({ path: './public/manifest.json' }))
app.get('/favicon.ico', serveStatic({ path: './public/favicon.ico' }))

app.get('*', (c) => c.html(renderShell()))

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

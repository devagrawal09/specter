import { serveStatic } from '@hono/node-server/serve-static'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { createClient } from '@libsql/client/sqlite3'
import { Hono } from 'hono'
import { createSpecterApp, EventLog, SpecterObserver } from '@specter-ts/core'
import {
  createRuntimeObservationEmitter,
  createRuntimeObservationProducer,
  type RuntimeSource,
} from '@specter-ts/observability'
import {
  createSqliteDatabaseContext,
  createSqliteReactionSchedulerLayer,
  createSpecterSqlitePersistence,
  prepareSqliteReactionScheduler,
  prepareSpecterSqlite,
} from '@specter-ts/sqlite'
import { Layer } from 'effect'

import { createSqliteSliceStoreLayer } from './db/specter-sqlite'
import { todoSpecterAppConfig } from './features/todos/registry'
import {
  todoSpecificationDigests,
  todoSpecifications,
} from './features/todos/specifications'
import { createSpecterHttpHandler } from './transport/specter-http.server'
import {
  createSqliteReactionTicketStore,
  prepareSqliteReactionTicketStore,
} from './transport/specter-reaction-tickets-sqlite.server'
import './styles.css?url'

const sqlitePath = process.env.SPECTER_SQLITE_PATH ?? './data/app.db'
mkdirSync(dirname(sqlitePath), { recursive: true })
const sqliteUrl = `file:${sqlitePath}`
const sqliteClient = createClient({ url: sqliteUrl })
const operationalSqliteClient = createClient({ url: sqliteUrl })
await prepareSpecterSqlite(sqliteClient)
await operationalSqliteClient.execute('PRAGMA journal_mode = WAL')
await operationalSqliteClient.execute('PRAGMA busy_timeout = 5000')
await prepareSqliteReactionScheduler(operationalSqliteClient)
await prepareSqliteReactionTicketStore(operationalSqliteClient)
const persistence = createSpecterSqlitePersistence(sqliteClient)
const operationalContext = createSqliteDatabaseContext(operationalSqliteClient)
const runtimeSource: RuntimeSource = {
  application: 'todo-reference',
  environment:
    process.env.SPECTER_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development',
  runtimeLanguage: 'typescript',
  runtimeVersion: '0.4.0',
  instanceId:
    process.env.SPECTER_INSTANCE_ID ?? `todo-reference-${process.pid}`,
  eventLogId: process.env.SPECTER_EVENT_LOG_ID ?? sqlitePath,
}
const observationProducer = createRuntimeObservationProducer({
  collectorUrl:
    process.env.SPECTER_OBSERVABILITY_URL ?? 'http://127.0.0.1:41739',
  source: runtimeSource,
  specifications: todoSpecifications,
})
const runtimeObservability = createRuntimeObservationEmitter({
  producer: observationProducer,
  source: runtimeSource,
  specificationDigests: todoSpecificationDigests,
})
const reactionSchedulerLayer = createSqliteReactionSchedulerLayer(
  operationalSqliteClient,
  { context: operationalContext },
)
const specterApp = await createSpecterApp(
  todoSpecterAppConfig,
  Layer.mergeAll(
    Layer.succeed(EventLog, persistence.eventLog),
    reactionSchedulerLayer,
    createSqliteSliceStoreLayer(persistence.context),
    Layer.succeed(SpecterObserver, runtimeObservability.observer),
  ),
)
const handleSpecterRequest = createSpecterHttpHandler({
  app: specterApp,
  basePath: '/api',
  run: (operation) => operation(),
  reactionTickets: createSqliteReactionTicketStore(operationalSqliteClient, {
    context: operationalContext,
  }),
})

const app = new Hono()

app.all('/api/*', (c) => handleSpecterRequest(c.req.raw))
app.all('/specter/v1', (c) =>
  c.json({ error: { code: 'NOT_FOUND', message: 'Route not found.' } }, 404),
)
app.all('/specter/v1/*', (c) =>
  c.json({ error: { code: 'NOT_FOUND', message: 'Route not found.' } }, 404),
)

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

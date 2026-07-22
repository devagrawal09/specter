import { serveStatic } from '@hono/node-server/serve-static'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { createClient } from '@libsql/client/sqlite3'
import { drizzle } from 'drizzle-orm/libsql/sqlite3'
import { Hono } from 'hono'
import { createSpecterApp, EventLog } from '@specter-ts/core'
import {
  createDurableReactionSchedulerLayer,
  type ReactionPass,
} from '@specter-ts/reaction-outbox'
import {
  createSqliteDatabaseContext,
  createSqliteReactionOutboxStore,
  createSpecterSqlitePersistence,
  prepareSqliteReactionOutbox,
  prepareSpecterSqlite,
} from '@specter-ts/sqlite'
import { Layer } from 'effect'

import { createSqliteSliceStoreLayer } from './db/specter-sqlite'
import { bookingSpecterAppConfig } from './features/bookings/registry'
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
const reactionSchedulerLayer = createDurableReactionSchedulerLayer(
  createSqliteReactionOutboxStore<ReactionPass>(operationalSqliteClient, {
    context: operationalContext,
  }),
)
const specterApp = await createSpecterApp(
  bookingSpecterAppConfig,
  Layer.mergeAll(
    Layer.succeed(EventLog, persistence.eventLog),
    reactionSchedulerLayer,
    createSqliteSliceStoreLayer(productionDb),
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

await seedRooms()

app.all('/api/*', (c) => handleSpecterRequest(c.req.raw))

const routes = app

app.use('/static/*', serveStatic({ root: './dist' }))
app.get('/manifest.json', serveStatic({ path: './public/manifest.json' }))
app.get('/favicon.ico', serveStatic({ path: './public/favicon.ico' }))

app.get('*', (c) => c.html(renderShell()))

function messageFromCause(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause)
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
    <title>Specter Booking Reference</title>
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

async function seedRooms() {
  const rooms = [
    {
      roomId: crypto.randomUUID(),
      name: 'Library',
      capacity: 6,
      location: 'Floor 1',
    },
    {
      roomId: crypto.randomUUID(),
      name: 'Boardroom',
      capacity: 12,
      location: 'Floor 2',
    },
    {
      roomId: crypto.randomUUID(),
      name: 'Studio',
      capacity: 4,
      location: 'Floor 3',
    },
  ]

  for (const room of rooms) {
    try {
      const execution = await specterApp.command({
        type: 'createRoom',
        payload: room,
      })
      await execution.reactions
    } catch (cause) {
      if (!messageFromCause(cause).includes('already in use')) {
        throw cause
      }
    }
  }
}

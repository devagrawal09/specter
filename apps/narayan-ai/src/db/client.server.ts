import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { createClient } from '@libsql/client/sqlite3'
import { drizzle } from 'drizzle-orm/libsql/sqlite3'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { EventLog } from '@specter-ts/core'
import {
  createSqliteDatabaseContext,
  createSpecterSqlitePersistence,
  prepareSpecterSqlite,
} from '@specter-ts/sqlite'
import { Layer } from 'effect'

import {
  createSqliteReactionTicketStore,
  prepareSqliteReactionTicketStore,
} from '../transport/specter-reaction-tickets-sqlite.server.ts'
import * as schema from './schema'
import { createSqliteSliceStoreLayer } from './specter-sqlite'
import { createTwilioDeliveryAttemptStore } from './twilio-delivery-attempts'
import { TwilioDeliveryAttempts } from '../features/narayan/send-twilio-outbound-reaction/twilio-outbound-plugin.server'

const sqlitePath = process.env.NARAYAN_AI_DB_PATH ?? './data/narayan-ai.db'
mkdirSync(dirname(sqlitePath), { recursive: true })

const sqlite = createClient({ url: `file:${sqlitePath}` })
const operationalSqlite = createClient({ url: `file:${sqlitePath}` })
export const db = drizzle(sqlite, { schema })
const operationalContext = createSqliteDatabaseContext(operationalSqlite)
let prepared: Promise<void> | undefined

export const narayanReactionTickets = createSqliteReactionTicketStore(
  operationalSqlite,
  { context: operationalContext },
)

export async function prepareNarayanAiDb() {
  prepared ??= (async () => {
    await migrate(db, { migrationsFolder: join(process.cwd(), 'drizzle') })
    await prepareSpecterSqlite(sqlite)
    await operationalSqlite.execute('PRAGMA journal_mode = WAL')
    await operationalSqlite.execute('PRAGMA busy_timeout = 5000')
    await prepareSqliteReactionTicketStore(operationalSqlite)
  })()
  await prepared
}

export async function runAfterNarayanReady<T>(run: () => Promise<T>) {
  await prepareNarayanAiDb()
  return run()
}

export function narayanDependenciesLayer() {
  const persistence = createSpecterSqlitePersistence(sqlite)
  return Layer.mergeAll(
    Layer.succeed(EventLog, persistence.eventLog),
    createSqliteSliceStoreLayer(persistence.context),
    Layer.succeed(TwilioDeliveryAttempts, createTwilioDeliveryAttemptStore(db)),
  )
}

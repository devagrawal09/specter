import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

import { createClient } from '@libsql/client/sqlite3'
import { EventLog } from '@specter-ts/core'
import {
  createSqliteDatabaseContext,
  createSpecterSqlitePersistence,
  prepareSpecterSqlite,
} from '@specter-ts/sqlite'
import { Layer } from 'effect'

import { threadplaneMemoryStoresLayer } from '../testing/memory-slice-store'
import {
  createSqliteReactionTicketStore,
  prepareSqliteReactionTicketStore,
} from '../transport/specter-reaction-tickets-sqlite.server.ts'

const sqlitePath =
  process.env.THREADPLANE_REFERENCE_DB_PATH ?? './data/threadplane-reference.db'
const sqliteUrl = `file:${sqlitePath}`

mkdirSync(dirname(sqlitePath), { recursive: true })

const sqlite = createClient({ url: sqliteUrl })
const operationalSqlite = createClient({ url: sqliteUrl })
const operationalContext = createSqliteDatabaseContext(operationalSqlite)
let prepared: Promise<void> | undefined

export const threadplaneReactionTickets = createSqliteReactionTicketStore(
  operationalSqlite,
  { context: operationalContext },
)

export async function prepareThreadplaneReferenceDb() {
  prepared ??= (async () => {
    await prepareSpecterSqlite(sqlite)
    await operationalSqlite.execute('PRAGMA journal_mode = WAL')
    await operationalSqlite.execute('PRAGMA busy_timeout = 5000')
    await prepareSqliteReactionTicketStore(operationalSqlite)
  })()
  await prepared
}

export function threadplaneDependenciesLayer() {
  const persistence = createSpecterSqlitePersistence(sqlite)
  return Layer.mergeAll(
    Layer.succeed(EventLog, persistence.eventLog),
    threadplaneMemoryStoresLayer(),
  )
}

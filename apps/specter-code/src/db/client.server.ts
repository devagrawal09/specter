import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

import { createClient } from '@libsql/client/sqlite3'
import { EventLog } from '@specter-ts/core'
import { createSqliteDatabaseContext } from '@specter-ts/sqlite'
import { Layer } from 'effect'

import { projectSpecterCodeEvent } from '../features/specter-code/adapters/read-models.ts'
import { specterCodeMemoryStoresLayer } from '../testing/memory-slice-store.ts'
import {
  createSqliteReactionTicketStore,
  prepareSqliteReactionTicketStore,
} from '../transport/specter-reaction-tickets-sqlite.server.ts'
import {
  createSpecterCodeEventLogService,
  prepareSpecterSqlite,
} from './specter-sqlite.ts'

const sqlitePath = process.env.SPECTER_CODE_DB_PATH ?? './data/specter-code.db'
const sqliteUrl = `file:${sqlitePath}`
mkdirSync(dirname(sqlitePath), { recursive: true })

export const specterCodeSqlite = createClient({ url: sqliteUrl })
const operationalSqlite = createClient({ url: sqliteUrl })
const operationalContext = createSqliteDatabaseContext(operationalSqlite)
export const specterCodeEventLog = createSpecterCodeEventLogService(
  specterCodeSqlite,
  projectSpecterCodeEvent,
)
let prepared: Promise<void> | undefined

export const specterCodeReactionTickets = createSqliteReactionTicketStore(
  operationalSqlite,
  { context: operationalContext },
)

export async function prepareSpecterCodeReferenceDb() {
  prepared ??= (async () => {
    await prepareSpecterSqlite(specterCodeSqlite)
    await operationalSqlite.execute('PRAGMA journal_mode = WAL')
    await operationalSqlite.execute('PRAGMA busy_timeout = 5000')
    await prepareSqliteReactionTicketStore(operationalSqlite)
  })()
  await prepared
}

export async function runAfterSpecterCodeReady<T>(run: () => Promise<T>) {
  await prepareSpecterCodeReferenceDb()
  return run()
}

export function specterCodeDependenciesLayer() {
  return Layer.mergeAll(
    Layer.succeed(EventLog, specterCodeEventLog),
    specterCodeMemoryStoresLayer(),
  )
}

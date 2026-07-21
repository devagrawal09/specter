import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

import { createClient } from '@libsql/client/sqlite3'
import type { ReactionScheduler } from '@specter-ts/core'
import {
  createDurableReactionScheduler,
  type ReactionPass,
} from '@specter-ts/reaction-outbox'
import {
  createSqliteDatabaseContext,
  createSqliteReactionOutboxStore,
  prepareSqliteReactionOutbox,
} from '@specter-ts/sqlite'

import {
  createSqliteReactionTicketStore,
  prepareSqliteReactionTicketStore,
} from '../transport/specter-reaction-tickets-sqlite.server.ts'

import {
  hasSqliteDbBinding,
  prepareSpecterSqlite,
  runWithSqliteDb,
} from './specter-sqlite'

const sqlitePath =
  process.env.THREADPLANE_REFERENCE_DB_PATH ?? './data/threadplane-reference.db'
const sqliteUrl = `file:${sqlitePath}`

mkdirSync(dirname(sqlitePath), { recursive: true })

const sqlite = createClient({ url: sqliteUrl })
const operationalSqlite = createClient({ url: sqliteUrl })
let prepared: Promise<void> | undefined
const operationalContext = createSqliteDatabaseContext(operationalSqlite)
const reactionOutbox = createSqliteReactionOutboxStore<ReactionPass>(
  operationalSqlite,
  { context: operationalContext },
)
const durableReactionScheduler = createDurableReactionScheduler(reactionOutbox)

export const threadplaneReactionTickets = createSqliteReactionTicketStore(
  operationalSqlite,
  {
    context: operationalContext,
  },
)

export const threadplaneProductionReactionScheduler: ReactionScheduler = (
  run,
) =>
  durableReactionScheduler((context) =>
    runWithThreadplaneReferenceDb(() => run(context)),
  )

export async function prepareThreadplaneReferenceDb() {
  prepared ??= (async () => {
    await prepareSpecterSqlite(sqlite)
    await operationalSqlite.execute('PRAGMA journal_mode = WAL')
    await operationalSqlite.execute('PRAGMA busy_timeout = 5000')
    await prepareSqliteReactionOutbox(operationalSqlite)
    await prepareSqliteReactionTicketStore(operationalSqlite)
  })()
  await prepared
}

export async function runWithThreadplaneReferenceDb<T>(run: () => Promise<T>) {
  if (hasSqliteDbBinding()) return run()

  await prepareThreadplaneReferenceDb()

  return runWithSqliteDb(sqlite, run)
}

import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

import { createClient } from '@libsql/client/sqlite3'
import { drizzle } from 'drizzle-orm/libsql/sqlite3'
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

import * as schema from './schema'
import { hasSqliteDbBinding, runWithSqliteDb } from './specter-sqlite'

const sqlitePath = process.env.NARAYAN_AI_DB_PATH ?? './data/narayan-ai.db'

mkdirSync(dirname(sqlitePath), { recursive: true })

const sqlite = createClient({ url: `file:${sqlitePath}` })
const operationalSqlite = createClient({ url: `file:${sqlitePath}` })
export const db = drizzle(sqlite, { schema })
let prepared: Promise<void> | undefined
const operationalContext = createSqliteDatabaseContext(operationalSqlite)
const reactionOutbox = createSqliteReactionOutboxStore<ReactionPass>(
  operationalSqlite,
  { context: operationalContext },
)
const durableReactionScheduler = createDurableReactionScheduler(
  reactionOutbox,
  {
    maxAttempts: 10,
    backoffMs: (attemptNumber) =>
      Math.min(5 * 60_000, 5_000 * 2 ** (attemptNumber - 1)),
  },
)

export const narayanReactionTickets = createSqliteReactionTicketStore(
  operationalSqlite,
  { context: operationalContext },
)

export const narayanProductionReactionScheduler: ReactionScheduler = (run) =>
  durableReactionScheduler((context) => runWithNarayanAiDb(() => run(context)))

export async function prepareNarayanAiDb() {
  prepared ??= (async () => {
    await operationalSqlite.execute('PRAGMA journal_mode = WAL')
    await operationalSqlite.execute('PRAGMA busy_timeout = 5000')
    await prepareSqliteReactionOutbox(operationalSqlite)
    await prepareSqliteReactionTicketStore(operationalSqlite)
  })()
  await prepared
}

export async function runWithNarayanAiDb<T>(run: () => Promise<T>) {
  if (hasSqliteDbBinding()) return run()
  await prepareNarayanAiDb()
  return runWithSqliteDb(db, run)
}

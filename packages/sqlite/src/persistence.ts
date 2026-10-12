import { Effect } from 'effect'

import { executeAll, type SqliteDatabaseContext } from './database'
import {
  createSqliteEventLogService,
  sqliteEventLogSchema,
  type SqliteEventLogOptions,
} from './event-log'
import {
  createSqliteReactionOutboxStore,
  sqliteReactionOutboxSchema,
  type SqliteReactionOutboxOptions,
} from './reaction-outbox'
import { sqliteReactionSchedulerSchema } from './reaction-scheduler'
import {
  createSqliteSliceSnapshotStore,
  sqliteSliceSnapshotSchema,
  type SqliteSliceSnapshotStoreOptions,
} from './slice-snapshot-store'
import {
  createSqliteSliceStoreService,
  sqliteSliceStoreSchema,
  type SqliteSliceStoreOptions,
} from './slice-store'

/**
 * Every table and index Specter's SQLite stores use. A host that runs its
 * own migrations runs the ones it uses (`sqliteEventLogSchema` and the
 * others) in one of them instead.
 */
export const specterSqliteSchema: readonly string[] = [
  ...sqliteEventLogSchema,
  ...sqliteSliceStoreSchema,
  ...sqliteSliceSnapshotSchema,
  ...sqliteReactionSchedulerSchema,
  ...sqliteReactionOutboxSchema,
]

/**
 * Turns on WAL and a five-second busy timeout for this connection, and
 * creates every table and index Specter's SQLite stores use.
 */
export function prepareSpecterSqlite(context: SqliteDatabaseContext) {
  return Effect.gen(function* () {
    yield* context.execute('PRAGMA journal_mode = WAL')
    yield* context.execute('PRAGMA busy_timeout = 5000')
    yield* executeAll(context, specterSqliteSchema)
  })
}

/** Specter's SQLite stores on one database, so they share its transactions. */
export function createSpecterSqlitePersistence<
  TContext extends SqliteDatabaseContext,
>(context: TContext, options: SqliteEventLogOptions = {}) {
  return {
    context,
    eventLog: createSqliteEventLogService(context, options),
    createReactionOutboxStore<TPayload>(
      outboxOptions: SqliteReactionOutboxOptions<TPayload> = {},
    ) {
      return createSqliteReactionOutboxStore<TPayload>(context, outboxOptions)
    },
    createSliceStoreService<TWriteState, TReadState = Readonly<TWriteState>>(
      createState: () => TWriteState,
      storeOptions: SqliteSliceStoreOptions<TWriteState, TReadState> = {},
    ) {
      return createSqliteSliceStoreService(context, createState, storeOptions)
    },
    createSliceSnapshotStore(
      snapshotOptions: SqliteSliceSnapshotStoreOptions = {},
    ) {
      return createSqliteSliceSnapshotStore(context, snapshotOptions)
    },
  }
}

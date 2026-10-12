import { Effect } from 'effect'

import type { SqliteDatabaseContext } from './database'
import {
  createSqliteEventLogService,
  sqliteEventLogMigrations,
  type SqliteEventLogOptions,
} from './event-log'
import { migrateSpecterSqlite, type SqliteMigration } from './migrations'
import {
  createSqliteReactionOutboxStore,
  sqliteReactionOutboxMigrations,
  type SqliteReactionOutboxOptions,
} from './reaction-outbox'
import { sqliteReactionSchedulerMigrations } from './reaction-scheduler'
import {
  createSqliteSliceSnapshotStore,
  sqliteSliceSnapshotMigrations,
  type SqliteSliceSnapshotStoreOptions,
} from './slice-snapshot-store'
import {
  createSqliteSliceStoreService,
  sqliteSliceStoreMigrations,
  type SqliteSliceStoreOptions,
} from './slice-store'

/**
 * Every store's migrations, store by store. A host that runs its own
 * migrations runs those of the stores it uses (`sqliteEventLogMigrations`
 * and the others) in its own instead.
 */
export const specterSqliteMigrations: readonly SqliteMigration[] = [
  ...sqliteEventLogMigrations,
  ...sqliteSliceStoreMigrations,
  ...sqliteSliceSnapshotMigrations,
  ...sqliteReactionSchedulerMigrations,
  ...sqliteReactionOutboxMigrations,
]

/**
 * Turns on WAL and a five-second busy timeout for this connection, and
 * brings every store's tables to their latest version
 * (`migrateSpecterSqlite` with `specterSqliteMigrations`).
 */
export function prepareSpecterSqlite(context: SqliteDatabaseContext) {
  return Effect.gen(function* () {
    yield* context.execute('PRAGMA journal_mode = WAL')
    yield* context.execute('PRAGMA busy_timeout = 5000')
    return yield* migrateSpecterSqlite(context, specterSqliteMigrations)
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

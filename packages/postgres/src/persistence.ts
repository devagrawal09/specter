import {
  createPostgresDatabaseContext,
  type PostgresDatabaseOptions,
  type PostgresPool,
} from './database'
import {
  createPostgresEventLogService,
  postgresEventLogMigrations,
  type PostgresEventLogOptions,
} from './event-log'
import type { PostgresMigration } from './migrations'
import {
  createPostgresReactionOutboxStore,
  postgresReactionOutboxMigrations,
  type PostgresReactionOutboxOptions,
} from './reaction-outbox'
import {
  createPostgresSliceStoreService,
  postgresSliceStoreMigrations,
  type PostgresSliceStoreOptions,
} from './slice-store'

/**
 * Every store's migrations, store by store, for `migrateSpecterPostgres`. A
 * host that runs its own migrations runs those of the stores it uses
 * (`postgresEventLogMigrations` and the others) in its own instead.
 */
export const specterPostgresMigrations: readonly PostgresMigration[] = [
  ...postgresEventLogMigrations,
  ...postgresSliceStoreMigrations,
  ...postgresReactionOutboxMigrations,
]

export function createSpecterPostgresPersistence(
  pool: PostgresPool,
  options: Omit<PostgresEventLogOptions, 'context'> = {},
) {
  const context = createPostgresDatabaseContext(pool, options)
  const eventLog = createPostgresEventLogService(pool, { ...options, context })

  return {
    context,
    eventLog,
    createReactionOutboxStore<TPayload>(
      outboxOptions: Omit<
        PostgresReactionOutboxOptions<TPayload>,
        'context' | keyof PostgresDatabaseOptions
      > = {},
    ) {
      return createPostgresReactionOutboxStore<TPayload>(pool, {
        ...outboxOptions,
        context,
      })
    },
    createSliceStoreService<TWriteState, TReadState = Readonly<TWriteState>>(
      createState: () => TWriteState,
      storeOptions: Omit<
        PostgresSliceStoreOptions<TWriteState, TReadState>,
        'context' | keyof PostgresDatabaseOptions
      > = {},
    ) {
      return createPostgresSliceStoreService(pool, createState, {
        ...storeOptions,
        context,
      })
    },
  }
}

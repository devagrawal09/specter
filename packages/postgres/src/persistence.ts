import {
  createPostgresDatabaseContext,
  type PostgresDatabaseOptions,
  type PostgresPool,
} from './database'
import {
  createPostgresEventLogService,
  preparePostgresEventLog,
  type PostgresEventLogOptions,
} from './event-log'
import {
  createPostgresSliceStoreService,
  preparePostgresSliceStore,
  type PostgresSliceStoreOptions,
} from './slice-store'
import {
  createPostgresReactionOutboxStore,
  preparePostgresReactionOutbox,
  type PostgresReactionOutboxOptions,
} from './reaction-outbox'

export async function prepareSpecterPostgres(pool: PostgresPool) {
  await preparePostgresEventLog(pool)
  await preparePostgresSliceStore(pool)
  await preparePostgresReactionOutbox(pool)
}

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

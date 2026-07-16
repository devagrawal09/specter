import {
  createPostgresDatabaseContext,
  type PostgresDatabaseOptions,
  type PostgresPool,
} from './database'
import {
  createPostgresEventLog,
  preparePostgresEventLog,
  type PostgresEventLogOptions,
} from './event-log'
import {
  createPostgresSliceStore,
  preparePostgresSliceStore,
  type PostgresSliceStoreOptions,
} from './slice-store'
import {
  createPostgresReactionOutboxStore,
  preparePostgresReactionOutbox,
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
  const eventLog = createPostgresEventLog(pool, { ...options, context })

  return {
    context,
    eventLog,
    createReactionOutboxStore<TPayload>() {
      return createPostgresReactionOutboxStore<TPayload>(pool, { context })
    },
    createSliceStore<TWriteState, TReadState = Readonly<TWriteState>>(
      createState: () => TWriteState,
      storeOptions: Omit<
        PostgresSliceStoreOptions<TWriteState, TReadState>,
        'context' | keyof PostgresDatabaseOptions
      > = {},
    ) {
      return createPostgresSliceStore(pool, createState, {
        ...storeOptions,
        context,
      })
    },
  }
}

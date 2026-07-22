import type { Client } from '@libsql/client'

import { createSqliteDatabaseContext } from './database'
import {
  createSqliteEventLogService,
  prepareSqliteEventLog,
  type SqliteEventLogOptions,
} from './event-log'
import {
  createSqliteSliceStoreService,
  prepareSqliteSliceStore,
  type SqliteSliceStoreOptions,
} from './slice-store'
import {
  createSqliteReactionOutboxStore,
  prepareSqliteReactionOutbox,
  type SqliteReactionOutboxOptions,
} from './reaction-outbox'
import { prepareSqliteReactionScheduler } from './reaction-scheduler'

export async function prepareSpecterSqlite(client: Client) {
  await client.execute('PRAGMA journal_mode = WAL')
  await client.execute('PRAGMA busy_timeout = 5000')
  await prepareSqliteEventLog(client)
  await prepareSqliteSliceStore(client)
  await prepareSqliteReactionScheduler(client)
  await prepareSqliteReactionOutbox(client)
}

export function createSpecterSqlitePersistence(
  client: Client,
  options: Omit<SqliteEventLogOptions, 'context'> = {},
) {
  const context = createSqliteDatabaseContext(client)
  const eventLog = createSqliteEventLogService(client, { ...options, context })

  return {
    context,
    eventLog,
    createReactionOutboxStore<TPayload>(
      outboxOptions: Omit<
        SqliteReactionOutboxOptions<TPayload>,
        'context'
      > = {},
    ) {
      return createSqliteReactionOutboxStore<TPayload>(client, {
        ...outboxOptions,
        context,
      })
    },
    createSliceStoreService<TWriteState, TReadState = Readonly<TWriteState>>(
      createState: () => TWriteState,
      storeOptions: Omit<
        SqliteSliceStoreOptions<TWriteState, TReadState>,
        'context'
      > = {},
    ) {
      return createSqliteSliceStoreService(client, createState, {
        ...storeOptions,
        context,
      })
    },
  }
}

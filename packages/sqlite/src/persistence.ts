import type { Client } from '@libsql/client'

import { createSqliteDatabaseContext } from './database'
import {
  createSqliteEventLog,
  prepareSqliteEventLog,
  type SqliteEventLogOptions,
} from './event-log'
import {
  createSqliteSliceStore,
  prepareSqliteSliceStore,
  type SqliteSliceStoreOptions,
} from './slice-store'
import {
  createSqliteReactionOutboxStore,
  prepareSqliteReactionOutbox,
} from './reaction-outbox'

export async function prepareSpecterSqlite(client: Client) {
  await client.execute('PRAGMA journal_mode = WAL')
  await client.execute('PRAGMA busy_timeout = 5000')
  await prepareSqliteEventLog(client)
  await prepareSqliteSliceStore(client)
  await prepareSqliteReactionOutbox(client)
}

export function createSpecterSqlitePersistence(
  client: Client,
  options: Omit<SqliteEventLogOptions, 'context'> = {},
) {
  const context = createSqliteDatabaseContext(client)
  const eventLog = createSqliteEventLog(client, { ...options, context })

  return {
    context,
    eventLog,
    createReactionOutboxStore<TPayload>() {
      return createSqliteReactionOutboxStore<TPayload>(client, { context })
    },
    createSliceStore<TWriteState, TReadState = Readonly<TWriteState>>(
      createState: () => TWriteState,
      storeOptions: Omit<
        SqliteSliceStoreOptions<TWriteState, TReadState>,
        'context'
      > = {},
    ) {
      return createSqliteSliceStore(client, createState, {
        ...storeOptions,
        context,
      })
    },
  }
}

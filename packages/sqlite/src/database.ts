import { AsyncLocalStorage } from 'node:async_hooks'

import type { Client, Transaction } from '@libsql/client'

export type SqliteConnection = Client | Transaction

export type SqliteDatabaseContext = {
  readonly client: Client
  connection(): SqliteConnection
  serialize<T>(run: () => Promise<T>): Promise<T>
  transaction<T>(run: (connection: SqliteConnection) => Promise<T>): Promise<T>
}

export function createSqliteDatabaseContext(
  client: Client,
): SqliteDatabaseContext {
  const scopedConnection = new AsyncLocalStorage<SqliteConnection>()
  const scopedSerialization = new AsyncLocalStorage<boolean>()
  let transactionTail = Promise.resolve()
  let serializationTail = Promise.resolve()

  return {
    client,
    connection() {
      return scopedConnection.getStore() ?? client
    },
    async serialize(run) {
      if (scopedSerialization.getStore() || scopedConnection.getStore()) {
        return run()
      }

      const previous = serializationTail
      let release = () => {}
      const current = new Promise<void>((resolve) => {
        release = resolve
      })
      const queued = previous.then(() => current)
      serializationTail = queued
      await previous

      try {
        return await scopedSerialization.run(true, run)
      } finally {
        release()
        if (serializationTail === queued) serializationTail = Promise.resolve()
      }
    },
    async transaction(run) {
      const active = scopedConnection.getStore()
      if (active) return run(active)

      const previous = transactionTail
      let release = () => {}
      const current = new Promise<void>((resolve) => {
        release = resolve
      })
      const queued = previous.then(() => current)
      transactionTail = queued
      await previous

      let transaction: Transaction | undefined
      try {
        transaction = await client.transaction('write')
        const activeTransaction = transaction
        const result = await scopedConnection.run(activeTransaction, () =>
          run(activeTransaction),
        )
        await transaction.commit()
        return result
      } catch (cause) {
        if (transaction && !transaction.closed) await transaction.rollback()
        throw cause
      } finally {
        transaction?.close()
        release()
        if (transactionTail === queued) transactionTail = Promise.resolve()
      }
    },
  }
}

export function requireString(value: unknown, field: string) {
  if (typeof value !== 'string') {
    throw new Error(`Expected SQLite ${field} to be a string`)
  }
  return value
}

export function requireNumber(value: unknown, field: string) {
  const number = typeof value === 'bigint' ? Number(value) : value
  if (
    typeof number !== 'number' ||
    !Number.isSafeInteger(number) ||
    number < 0
  ) {
    throw new Error(`Expected SQLite ${field} to be a number`)
  }
  return number
}

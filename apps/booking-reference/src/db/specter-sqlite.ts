import { AsyncLocalStorage } from 'node:async_hooks'
import { eq, sql } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/libsql/sqlite3'
import type { SliceStoreAdapter } from '@specter-ts/core'

import type * as schema from './schema'
import { sliceCursors } from './specter-schema'

export type SqliteDb = ReturnType<typeof drizzle<typeof schema>>
type SqliteTransaction = Parameters<Parameters<SqliteDb['transaction']>[0]>[0]
export type ScopedSqliteDb = SqliteDb | SqliteTransaction

const scopedSqliteDb = new AsyncLocalStorage<ScopedSqliteDb>()
const scopedSliceSerialization = new AsyncLocalStorage<boolean>()
let sliceSerializationTail = Promise.resolve()

function getDb() {
  const scopedDb = scopedSqliteDb.getStore()
  if (!scopedDb) {
    throw new Error('No SQLite database is bound to the current async context')
  }
  return scopedDb
}

export function runWithSqliteDb<T>(db: SqliteDb, run: () => Promise<T>) {
  return scopedSqliteDb.run(db, run)
}

export const sqliteSliceStore: SliceStoreAdapter<ScopedSqliteDb> = {
  get: async (sliceName) => createSliceStore(sliceName),
  transaction: (sliceName, run) =>
    serializeSliceOperation(() => run(createSliceStore(sliceName))),
}

async function serializeSliceOperation<T>(run: () => Promise<T>) {
  if (scopedSliceSerialization.getStore()) return run()
  const previous = sliceSerializationTail
  let release = () => {}
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  sliceSerializationTail = previous.then(() => current)
  await previous
  try {
    return await scopedSliceSerialization.run(true, run)
  } finally {
    release()
  }
}

function createSliceStore(sliceName: string) {
  return {
    write: getDb(),
    read: getDb(),
    lastAppliedOrder: async () => {
      const rows = await getDb()
        .select()
        .from(sliceCursors)
        .where(eq(sliceCursors.sliceName, sliceName))
        .all()

      return rows[0]?.lastAppliedOrder ?? 0
    },
    setLastAppliedOrder: async (order: number) => {
      await getDb()
        .insert(sliceCursors)
        .values({ sliceName, lastAppliedOrder: order })
        .onConflictDoUpdate({
          target: sliceCursors.sliceName,
          set: {
            lastAppliedOrder: sql`max(${sliceCursors.lastAppliedOrder}, ${order})`,
          },
        })
        .run()
    },
  }
}

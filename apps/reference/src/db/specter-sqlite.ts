import { eq, sql } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/libsql/sqlite3'
import type { SliceStoreService } from '@specter-ts/core'
import { Context, Effect, Layer } from 'effect'

import type * as schema from './schema'
import { sliceCursors } from './specter-schema'

export type SqliteDb = ReturnType<typeof drizzle<typeof schema>>
type SqliteTransaction = Parameters<Parameters<SqliteDb['transaction']>[0]>[0]
type ScopedSqliteDb = SqliteDb | SqliteTransaction

export const sqliteSliceStore = Context.Service<
  SliceStoreService<ScopedSqliteDb, ScopedSqliteDb, unknown>
>('@specter/reference/SqliteSliceStore')

export function createSqliteSliceStoreLayer(db: SqliteDb) {
  let transactionTail = Promise.resolve()

  async function loadCursor(connection: ScopedSqliteDb, sliceName: string) {
    const rows = await connection
      .select()
      .from(sliceCursors)
      .where(eq(sliceCursors.sliceName, sliceName))
      .all()
    return rows[0]?.lastAppliedOrder ?? 0
  }

  const service: SliceStoreService<
    ScopedSqliteDb,
    ScopedSqliteDb,
    unknown
  > = {
    read: (sliceName, run) =>
      Effect.tryPromise({
        try: async () => run(db, await loadCursor(db, sliceName)),
        catch: (cause) => cause,
      }),
    transaction: (sliceName, run) =>
      Effect.tryPromise({
        try: async () => {
          const previous = transactionTail
          let release = () => {}
          transactionTail = new Promise<void>((resolve) => {
            release = resolve
          })
          await previous
          try {
            return await db.transaction(async (transaction) => {
              const cursor = await loadCursor(transaction, sliceName)
              return run(
                transaction,
                () => transaction,
                cursor,
                async (order) => {
                  if (!Number.isInteger(order) || order < cursor) {
                    throw new Error(
                      `Slice cursor must advance monotonically from ${cursor}, received ${order}`,
                    )
                  }
                  await transaction
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
              )
            })
          } finally {
            release()
          }
        },
        catch: (cause) => cause,
      }),
  }

  return Layer.succeed(sqliteSliceStore, service)
}

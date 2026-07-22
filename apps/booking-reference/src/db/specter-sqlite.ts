import { eq, sql } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/libsql/sqlite3'
import type { SliceStoreService } from '@specter-ts/core'
import { Context, Effect, Layer, Semaphore } from 'effect'

import type * as schema from './schema'
import { sliceCursors } from './specter-schema'

export type SqliteDb = ReturnType<typeof drizzle<typeof schema>>
type SqliteTransaction = Parameters<Parameters<SqliteDb['transaction']>[0]>[0]
export type ScopedSqliteDb = SqliteDb | SqliteTransaction

export const sqliteSliceStore = Context.Service<
  SliceStoreService<ScopedSqliteDb, ScopedSqliteDb, unknown>
>('@specter/booking-reference/SqliteSliceStore')

export function createSqliteSliceStoreLayer(db: SqliteDb) {
  const semaphore = Semaphore.makeUnsafe(1)

  async function loadCursor(connection: ScopedSqliteDb, sliceName: string) {
    const rows = await connection
      .select()
      .from(sliceCursors)
      .where(eq(sliceCursors.sliceName, sliceName))
      .all()
    return rows[0]?.lastAppliedOrder ?? 0
  }

  const service: SliceStoreService<ScopedSqliteDb, ScopedSqliteDb, unknown> = {
    read: (sliceName, run) =>
      Effect.gen(function* () {
        const cursor = yield* Effect.tryPromise(() => loadCursor(db, sliceName))
        return yield* run(db, cursor)
      }),
    transaction: <A, E, R>(
      sliceName: string,
      run: Parameters<
        SliceStoreService<
          ScopedSqliteDb,
          ScopedSqliteDb,
          unknown
        >['transaction']
      >[1],
    ): Effect.Effect<A, unknown | E, R> =>
      semaphore.withPermit(
        Effect.gen(function* () {
          const services = yield* Effect.context<R>()
          return yield* Effect.tryPromise({
            try: () =>
              db.transaction(async (transaction) => {
                const cursor = await loadCursor(transaction, sliceName)
                return Effect.runPromiseWith(services)(
                  run(
                    transaction,
                    () => transaction,
                    cursor,
                    (order) => {
                      if (!Number.isSafeInteger(order) || order < cursor) {
                        return Effect.fail(
                          new Error(
                            `Slice cursor must advance monotonically from ${cursor}, received ${order}`,
                          ),
                        )
                      }
                      return Effect.tryPromise(() =>
                        transaction
                          .insert(sliceCursors)
                          .values({ sliceName, lastAppliedOrder: order })
                          .onConflictDoUpdate({
                            target: sliceCursors.sliceName,
                            set: {
                              lastAppliedOrder: sql`max(${sliceCursors.lastAppliedOrder}, ${order})`,
                            },
                          })
                          .run(),
                      ).pipe(Effect.asVoid)
                    },
                  ) as Effect.Effect<A, E, R>,
                )
              }),
            catch: (cause) => cause,
          })
        }),
      ),
  }

  return Layer.succeed(sqliteSliceStore, service)
}

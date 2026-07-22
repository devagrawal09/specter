import type { Client } from '@libsql/client/sqlite3'
import type { SliceStoreService } from '@specter-ts/core'
import type {
  SqliteConnection,
  SqliteDatabaseContext,
} from '@specter-ts/sqlite'
import { eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/libsql/sqlite3'
import { Effect, Layer } from 'effect'

import * as schema from './schema'
import { sliceCursors } from './specter-schema'
import { sqliteSliceStore } from './specter-store'

export { sqliteSliceStore } from './specter-store'

export type SqliteDb = ReturnType<typeof drizzle<typeof schema>>
type ScopedSqliteDb = SqliteDb

export function createSqliteSliceStoreLayer(context: SqliteDatabaseContext) {
  const database = (client: SqliteConnection) =>
    drizzle(client as Client, { schema })

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
      context.use((connection) => {
        const scoped = database(connection)
        return Effect.gen(function* () {
          const cursor = yield* Effect.tryPromise(() =>
            loadCursor(scoped, sliceName),
          )
          return yield* run(scoped, cursor)
        })
      }),
    transaction: (sliceName, run) =>
      context.transaction((connection) => {
        const scoped = database(connection)
        return Effect.gen(function* () {
          const cursor = yield* Effect.tryPromise(() =>
            loadCursor(scoped, sliceName),
          )
          return yield* run(
            scoped,
            () => scoped,
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
                scoped
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
          )
        })
      }),
  }

  return Layer.succeed(sqliteSliceStore, service)
}

import { eq, sql } from 'drizzle-orm'
import * as SqliteDrizzle from '@effect/sql-drizzle/Sqlite'
import { Effect, Layer } from 'effect'
import type { SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy'

import { sliceCursors } from '../lib_legacy'
import { SliceStates, type SliceState } from './services'

export const SliceStatesLive = Layer.effect(
  SliceStates,
  Effect.gen(function* () {
    const db = yield* SqliteDrizzle.SqliteDrizzle

    return {
      create: (sliceName: string) => createSqlSliceState(sliceName, db),
    }
  }),
)

function createSqlSliceState(
  sliceName: string,
  db: SqliteRemoteDatabase,
): SliceState {
  return {
    input: db,
    lastAppliedOrder: Effect.gen(function* () {
      const rows = yield* db
        .select()
        .from(sliceCursors)
        .where(eq(sliceCursors.sliceName, sliceName))

      return rows[0]?.lastAppliedOrder ?? 0
    }),
    setLastAppliedOrder: (order) =>
      Effect.gen(function* () {
        yield* db
          .insert(sliceCursors)
          .values({ sliceName, lastAppliedOrder: order })
          .onConflictDoUpdate({
            target: sliceCursors.sliceName,
            set: {
              lastAppliedOrder: sql`max(${sliceCursors.lastAppliedOrder}, ${order})`,
            },
          })
      }),
  }
}

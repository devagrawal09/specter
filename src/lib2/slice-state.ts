import { eq } from 'drizzle-orm'
import * as SqliteDrizzle from '@effect/sql-drizzle/Sqlite'
import { Effect, Layer } from 'effect'
import type { SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy'

import { sliceCursors } from '../lib_legacy'
import { emptySnapshot, type JsonSliceSnapshot } from './json-storage'
import { JsonTx, SliceStates, type SliceState } from './services'

export const SliceStatesLive = Layer.effect(
  SliceStates,
  Effect.gen(function* () {
    const db = yield* SqliteDrizzle.SqliteDrizzle
    const jsonStorage = yield* JsonTx

    return {
      create: (sliceName: string, json: boolean) =>
        json
          ? createJsonSliceState(
              jsonStorage.read(sliceName) ?? emptySnapshot(),
              (snapshot) => jsonStorage.write(sliceName, snapshot),
            )
          : createSqlSliceState(sliceName, db),
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
          .delete(sliceCursors)
          .where(eq(sliceCursors.sliceName, sliceName))
        yield* db
          .insert(sliceCursors)
          .values({ sliceName, lastAppliedOrder: order })
      }),
    commit: Effect.void,
  }
}

function createJsonSliceState(
  snapshot: JsonSliceSnapshot,
  write: (snapshot: JsonSliceSnapshot) => void,
): SliceState {
  const pendingSnapshot = structuredClone(snapshot)
  let dirty = false

  return {
    input: {
      get: <TValue>(key: string) =>
        pendingSnapshot.state[key] as TValue | undefined,
      set: (key: string, value: unknown) => {
        pendingSnapshot.state[key] = value
        dirty = true
      },
      patch: (key: string, value: Record<string, unknown>) => {
        const existing = pendingSnapshot.state[key] as
          | Record<string, unknown>
          | undefined
        pendingSnapshot.state[key] = { ...(existing ?? {}), ...value }
        dirty = true
      },
      delete: (key: string) => {
        delete pendingSnapshot.state[key]
        dirty = true
      },
    },
    lastAppliedOrder: Effect.succeed(pendingSnapshot.lastAppliedOrder),
    setLastAppliedOrder: (order) => {
      pendingSnapshot.lastAppliedOrder = order
      dirty = true
      return Effect.void
    },
    commit: Effect.sync(() => {
      if (!dirty) {
        return
      }

      write(pendingSnapshot)
      dirty = false
    }),
  }
}

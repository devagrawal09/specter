import { eq } from 'drizzle-orm'

import type { StoreTx } from '.'
import { sliceCursors } from '.'
import type {
  JsonReadStore,
  JsonWriteStore,
  SliceRegistration,
} from './registry.builders'
import type { JsonSliceSnapshot, JsonSliceStorage } from './json-storage'
import { emptySnapshot } from './json-storage'

export type BoundSliceState = {
  input: StoreTx | JsonWriteStore
  lastAppliedOrder: () => number
  setLastAppliedOrder: (order: number) => void
  commit: () => void
}

export function createSliceState(
  sliceName: string,
  registration: SliceRegistration,
  runtime: { tx: StoreTx; jsonStorage: JsonSliceStorage },
): BoundSliceState {
  if (registration.json) {
    return createJsonSliceState(sliceName, runtime.jsonStorage)
  }

  return createSqlSliceState(sliceName, runtime.tx)
}

function createSqlSliceState(sliceName: string, tx: StoreTx): BoundSliceState {
  return {
    input: tx,
    lastAppliedOrder: () =>
      tx
        .select()
        .from(sliceCursors)
        .where(eq(sliceCursors.sliceName, sliceName))
        .get()?.lastAppliedOrder ?? 0,
    setLastAppliedOrder: (order) => {
      tx.delete(sliceCursors).where(eq(sliceCursors.sliceName, sliceName)).run()

      tx.insert(sliceCursors)
        .values({ sliceName, lastAppliedOrder: order })
        .run()
    },
    commit: () => {},
  }
}

function createJsonSliceState(
  sliceName: string,
  storage: JsonSliceStorage,
): BoundSliceState {
  const snapshot = storage.read(sliceName) ?? emptySnapshot()
  let dirty = false
  const store = createJsonWriteStore(snapshot, () => {
    dirty = true
  })

  return {
    input: store,
    lastAppliedOrder: () => snapshot.lastAppliedOrder,
    setLastAppliedOrder: (order) => {
      snapshot.lastAppliedOrder = order
      dirty = true
    },
    commit: () => {
      if (!dirty) {
        return
      }

      storage.write(sliceName, snapshot)
      dirty = false
    },
  }
}

function createJsonReadStore(snapshot: JsonSliceSnapshot): JsonReadStore {
  return {
    get: <TValue>(key: string) => {
      return snapshot.state[key] as TValue | undefined
    },
  }
}

function createJsonWriteStore(
  snapshot: JsonSliceSnapshot,
  markDirty: () => void,
): JsonWriteStore {
  return {
    ...createJsonReadStore(snapshot),
    set: (key, value) => {
      snapshot.state[key] = value
      markDirty()
    },
    patch: (key, value) => {
      const existing = snapshot.state[key] as
        | Record<string, unknown>
        | undefined
      snapshot.state[key] = { ...(existing ?? {}), ...value }
      markDirty()
    },
    delete: (key) => {
      delete snapshot.state[key]
      markDirty()
    },
  }
}

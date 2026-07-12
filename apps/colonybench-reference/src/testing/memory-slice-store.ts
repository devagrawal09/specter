import type { SliceStore, SliceStoreAdapter } from '@specter-ts/core'

export function createMemorySliceStore<TState>(
  createState: () => TState,
): SliceStoreAdapter<TState> {
  type Entry = { state: TState; order: number }
  const entries = new Map<string, Entry>()

  function getEntry(sliceName: string) {
    let entry = entries.get(sliceName)

    if (!entry) {
      entry = { state: createState(), order: 0 }
      entries.set(sliceName, entry)
    }

    return entry
  }

  function getStore(sliceName: string): SliceStore<TState> {
    const entry = getEntry(sliceName)

    return {
      write: entry.state,
      read: entry.state,
      lastAppliedOrder: async () => entry.order,
      setLastAppliedOrder: async (order) => {
        entry.order = order
      },
    }
  }

  return {
    get: async (sliceName) => getStore(sliceName),
    transaction: async (sliceName, run) => run(getStore(sliceName)),
  }
}

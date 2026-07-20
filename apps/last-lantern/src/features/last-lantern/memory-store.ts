import { createMemorySliceStore } from '@specter-ts/memory'

const stores: Array<{ reset(sliceName?: string): void }> = []

export function createLastLanternMemoryStore<T>(createState: () => T) {
  const store = createMemorySliceStore(createState)
  stores.push(store)
  return store
}

export function resetLastLanternMemoryStores() {
  for (const store of stores) store.reset()
}

import { createMemorySliceStore } from '@specter-ts/memory'

type ResettableStore = { reset(sliceName?: string): void }

const stores: ResettableStore[] = []

export function createWorklogMemoryStore<TState>(createState: () => TState) {
  const store = createMemorySliceStore(createState)
  stores.push(store)
  return store
}

export function resetWorklogMemoryStores() {
  for (const store of stores) store.reset()
}

import { createMemorySliceStore as createSpecterMemorySliceStore } from '@specter-ts/memory'

const resetters = new Set<() => void>()

export function createMemorySliceStore<TState>(createState: () => TState) {
  const store = createSpecterMemorySliceStore(createState)
  resetters.add(() => store.reset())
  return store
}

export function resetMemorySliceStores() {
  for (const reset of resetters) reset()
}

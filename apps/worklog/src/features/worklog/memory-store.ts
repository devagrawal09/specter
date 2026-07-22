import type { SliceStoreService } from '@specter-ts/core'
import { createMemorySliceStoreService } from '@specter-ts/memory'
import { Context, Layer } from 'effect'

// biome-ignore lint/suspicious/noExplicitAny: heterogeneous Store Tags require one app-wiring erasure boundary.
type ErasedLayer = Layer.Layer<any>

const layers: ErasedLayer[] = []
const resetters = new Set<() => void>()
let storeNumber = 0

export function defineWorklogMemoryStore<TState>(createState: () => TState) {
  const tag = Context.Service<
    SliceStoreService<Readonly<TState>, TState, unknown>
  >(`@specter/worklog/store/${++storeNumber}`)
  layers.push(
    Layer.sync(tag, () => {
      const service = createMemorySliceStoreService(createState)
      resetters.add(() => service.reset())
      return service
    }),
  )
  return tag
}

export function worklogMemoryStoresLayer(): ErasedLayer {
  return layers.reduce(
    (combined, layer) => Layer.merge(combined, layer),
    Layer.empty as unknown as ErasedLayer,
  )
}

export function resetWorklogMemoryStores() {
  for (const reset of resetters) reset()
}

import type { SliceStoreService } from '@specter-ts/core'
import { createMemorySliceStoreService } from '@specter-ts/memory'
import { Context, Layer } from 'effect'

const layers: Layer.Layer<any, any, any>[] = []
const resetters = new Set<() => void>()
let storeNumber = 0

export function defineMemorySliceStore<TState>(createState: () => TState) {
  const tag = Context.Service<
    SliceStoreService<Readonly<TState>, TState, unknown>
  >(`@specter/specter-code/store/${++storeNumber}`)
  layers.push(
    Layer.sync(tag, () => {
      const service = createMemorySliceStoreService(createState)
      resetters.add(() => service.reset())
      return service
    }),
  )
  return tag
}

export function specterCodeMemoryStoresLayer(): Layer.Layer<any> {
  return layers.reduce(
    (combined, layer) => Layer.merge(combined, layer),
    Layer.empty as unknown as Layer.Layer<any, any, any>,
  ) as Layer.Layer<any>
}

export function resetMemorySliceStores() {
  for (const reset of resetters) reset()
}

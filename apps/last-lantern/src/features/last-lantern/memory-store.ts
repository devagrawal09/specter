import type { SliceStoreService } from '@specter-ts/core'
import { createMemorySliceStoreLayer } from '@specter-ts/memory'
import { Context } from 'effect'

type LastLanternStoreIdentifier<TState> = {
  readonly _lastLanternStoreState: TState
}

export function createLastLanternMemoryStore<TState>(
  sliceName: string,
  createState: () => TState,
) {
  const store = Context.Service<
    LastLanternStoreIdentifier<TState>,
    SliceStoreService<Readonly<TState>, TState, unknown>
  >(`@specter/last-lantern/${sliceName}Store`)

  return {
    store,
    layer: createMemorySliceStoreLayer(store, createState),
  }
}

import { Context, Effect, Layer } from 'effect'

import type { SliceStoreService } from '../adapters'

let storeNumber = 0

export function createTestSliceStore<TState extends object>(
  initialState: TState,
) {
  let state = structuredClone(initialState)
  let cursor = 0
  const service: SliceStoreService<TState, TState, unknown> = {
    read: (_sliceName, run) => Effect.suspend(() => run(state, cursor)),
    transaction: (_sliceName, run) =>
      Effect.suspend(() =>
        run(
          state,
          () => state,
          cursor,
          (order) =>
            Effect.sync(() => {
              cursor = order
            }),
        ),
      ),
  }
  const tag = Context.Service<SliceStoreService<TState, TState, unknown>>(
    `@specter-ts/core/test-store/${++storeNumber}`,
  )

  return {
    tag,
    service,
    layer: Layer.succeed(tag, service),
    reset() {
      state = structuredClone(initialState)
      cursor = 0
    },
  }
}

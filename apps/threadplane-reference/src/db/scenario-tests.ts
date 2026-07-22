import { Effect } from 'effect'

import { threadplaneMemoryStoresLayer } from '../testing/memory-slice-store'
import { resetMemorySliceStores } from '../testing/memory-slice-store'

export function sqliteScenario<T>(
  program: Effect.Effect<T, unknown, unknown>,
): Promise<T>
export function sqliteScenario<T>(run: () => Promise<T>): Promise<T>
export async function sqliteScenario<T>(
  programOrRun: Effect.Effect<T, unknown, unknown> | (() => Promise<T>),
) {
  try {
    resetMemorySliceStores()
    return await (typeof programOrRun === 'function'
      ? programOrRun()
      : Effect.runPromise(
          programOrRun.pipe(Effect.provide(threadplaneMemoryStoresLayer())),
        ))
  } finally {
    resetMemorySliceStores()
  }
}

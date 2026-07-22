import { testSliceImplementations } from '@specter-ts/core/testing'
import { Effect } from 'effect'

import { worklogEventDefinitions } from './events'
import {
  resetWorklogMemoryStores,
  worklogMemoryStoresLayer,
} from './memory-store'
import { worklogRegistrations } from './registry'

testSliceImplementations(worklogRegistrations, {
  events: worklogEventDefinitions,
  runScenario: async <T>(program: Effect.Effect<T, unknown, unknown>) => {
    resetWorklogMemoryStores()
    return Effect.runPromise(
      program.pipe(Effect.provide(worklogMemoryStoresLayer())) as Effect.Effect<
        T,
        unknown,
        never
      >,
    )
  },
})

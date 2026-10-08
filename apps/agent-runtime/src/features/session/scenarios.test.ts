import { eventsFor, testSliceImplementation } from '@specter-ts/core/testing'
import { Effect } from 'effect'

import { memorySliceStoreLayer, sessionAppConfig } from '../../app.ts'

// The full session catalog has 49 events and only three slices exist so far,
// so each Slice is tested against the events its scenarios and apply handlers
// need (eventsFor), not the whole-app catalog.
for (const slice of Object.values(sessionAppConfig.slices)) {
  testSliceImplementation(slice, {
    events: eventsFor(slice, sessionAppConfig.events),
    // Fresh in-memory Slice stores per scenario.
    runScenario: (program) =>
      Effect.runPromise(
        program.pipe(Effect.provide(memorySliceStoreLayer)) as Effect.Effect<
          never,
          unknown,
          never
        >,
      ),
  })
}

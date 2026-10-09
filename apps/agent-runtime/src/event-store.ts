import { makeSpecterRuntime } from '@specter-ts/core/effect'
import { eventsFor } from '@specter-ts/core/testing'
import {
  createImmediateReactionSchedulerLayer,
  createMemorySliceStoreLayer,
} from '@specter-ts/memory'
import { Effect, Layer } from 'effect'

import type { ProvideSliceStore } from './app.ts'
import { sessionEventDefinitions } from './events.ts'
import {
  createRecordSessionFactsState,
  recordSessionFacts,
  recordSessionFactsStore,
} from './features/session/record-session-facts/impl.ts'

// The runtime as an embedding host's event store: every Session fact the host
// decides is recorded by a runtime Command into the Event Log the host
// provides (OC++ keeps it in its own database, in the same transaction as its
// projections). Slices that take over the host's invariants join this config
// family by family.
const slices = { recordSessionFacts } as const

export const sessionEventStoreConfig = {
  events: [
    ...new Map(
      Object.values(slices)
        .flatMap((slice) => eventsFor(slice, sessionEventDefinitions))
        .map((definition) => [definition.type, definition]),
    ).values(),
  ],
  slices,
}

// Requires the EventLog service, which the host provides. Its Slice is kept
// in memory unless the host supplies a store that starts from a snapshot
// (makeSnapshotSliceStores), as for the embedded runtime.
export const makeSessionEventStore = (
  options: { readonly slices?: ProvideSliceStore } = {},
) =>
  makeSpecterRuntime(sessionEventStoreConfig).pipe(
    Effect.provide(
      Layer.mergeAll(
        (options.slices ?? createMemorySliceStoreLayer)(
          recordSessionFactsStore,
          createRecordSessionFactsState,
        ),
        createImmediateReactionSchedulerLayer(),
      ),
    ),
  )

export type SessionEventStore = Effect.Success<
  ReturnType<typeof makeSessionEventStore>
>

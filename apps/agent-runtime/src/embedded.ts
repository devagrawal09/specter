import { makeSpecterRuntime } from '@specter-ts/core/effect'
import { eventsFor } from '@specter-ts/core/testing'
import { createImmediateReactionSchedulerLayer } from '@specter-ts/memory'
import {
  createMemoryReactionOutboxStore,
  type OutboxedReaction,
} from '@specter-ts/reaction-outbox'
import { Effect, Layer } from 'effect'

import {
  createSessionAppConfig,
  memorySliceStoreLayer,
  type RunStepOutboxOptions,
} from './app.ts'
import type { RunStepRequest } from './features/session/run-step-reaction/impl.ts'
import type { RunStepOptions } from './plugins/run-step.ts'

// The runtime embedded in a host process (OC++ core) to run whole Sessions. It
// owns every Session Execution fact it records, into the Event Log the host
// provides (OC++ keeps it in its own database and projects each commit as its
// own events in the same transaction).
export type EmbeddedSessionRuntimeOptions = {
  readonly step?: RunStepOptions
  // The step outbox's worker, including how many Sessions run steps at once.
  readonly outbox?: RunStepOutboxOptions
}

// Requires the EventLog and StepHost services and a Scope. The host supplies the
// step's I/O through StepHost (or the runtime's own, modelStepHostLayer).
export const makeEmbeddedSessionRuntime = (
  options: EmbeddedSessionRuntimeOptions = {},
) => {
  const config = createSessionAppConfig(
    createMemoryReactionOutboxStore<OutboxedReaction<RunStepRequest>>(),
    options.outbox,
    options.step,
  )
  // Conformance wants every registered Event covered by a scenario, and most
  // of the catalog is not ported: register the events the Slices use.
  const events = [
    ...new Map(
      Object.values(config.slices)
        .flatMap((slice) => eventsFor(slice, config.events))
        .map((definition) => [definition.type, definition]),
    ).values(),
  ]
  return makeSpecterRuntime({ ...config, events }).pipe(
    Effect.provide(
      Layer.mergeAll(
        memorySliceStoreLayer,
        createImmediateReactionSchedulerLayer(),
      ),
    ),
  )
}

export type EmbeddedSessionRuntime = Effect.Success<
  ReturnType<typeof makeEmbeddedSessionRuntime>
>

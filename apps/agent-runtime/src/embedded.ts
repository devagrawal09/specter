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
  createSliceStoreLayer,
  type DriveExecutionOutboxStore,
  memorySliceStoreLayer,
  type ProvideSliceStore,
  type RunStepOutboxOptions,
  type RunStepOutboxStore,
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
  // Where the runtime keeps its own state. In memory by default, so each
  // boot folds the whole log and replays every Reaction over it (replayed
  // Commands are idempotent). A host that persists them boots from where it
  // stopped: Slice states from their cursors, and outboxed jobs, which dedupe
  // a replayed Reaction's output.
  readonly stores?: {
    readonly slices?: ProvideSliceStore
    readonly runStep?: RunStepOutboxStore
    readonly drive?: DriveExecutionOutboxStore
  }
  // Catch every Slice up to the log at boot, instead of each Command and
  // Query Slice when it is first used. Slices then hold the log's state as soon as the runtime is
  // up, which a host that saves them can check against a fold of the log.
  readonly catchUp?: boolean
}

// Requires the EventLog and StepHost services and a Scope. The host supplies the
// step's I/O through StepHost (or the runtime's own, modelStepHostLayer).
export const makeEmbeddedSessionRuntime = (
  options: EmbeddedSessionRuntimeOptions = {},
) => {
  const config = createSessionAppConfig(
    options.stores?.runStep ??
      createMemoryReactionOutboxStore<OutboxedReaction<RunStepRequest>>(),
    options.outbox,
    options.step,
    options.stores?.drive,
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
  return makeSpecterRuntime(
    { ...config, events },
    options.catchUp ? { catchUp: 'all' } : {},
  ).pipe(
    Effect.provide(
      Layer.mergeAll(
        options.stores?.slices
          ? createSliceStoreLayer(options.stores.slices)
          : memorySliceStoreLayer,
        createImmediateReactionSchedulerLayer(),
      ),
    ),
  )
}

export type EmbeddedSessionRuntime = Effect.Success<
  ReturnType<typeof makeEmbeddedSessionRuntime>
>

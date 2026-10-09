import {
  EventLog,
  type EventLogService,
  type PersistedEvent,
} from '@specter-ts/core'
import { makeSpecterRuntime } from '@specter-ts/core/effect'
import { eventsFor } from '@specter-ts/core/testing'
import {
  createImmediateReactionSchedulerLayer,
  createMemoryEventLog,
} from '@specter-ts/memory'
import {
  createMemoryReactionOutboxStore,
  type OutboxedReaction,
} from '@specter-ts/reaction-outbox'
import { Effect, Layer, Semaphore } from 'effect'

import { createSessionAppConfig, memorySliceStoreLayer } from './app.ts'
import type { RunStepRequest } from './features/session/run-step-reaction/impl.ts'
import type { RunStepOptions } from './plugins/run-step.ts'

// The runtime embedded in a host process (OC++ core). The runtime owns every
// Session Execution fact it records; the host keeps its own event stream and
// projections in step by receiving each commit through `onCommit`.
export type EmbeddedSessionRuntimeOptions = {
  // Receives every new commit, in log order, before the Command that appended
  // it returns. Appends wait for it, so a host that publishes here sees the
  // same order as the Event Log. A failure here is a defect: the commit is
  // already recorded.
  readonly onCommit: (events: readonly PersistedEvent[]) => Effect.Effect<void>
  // Event IDs and timestamps for new events (the host's own formats).
  readonly eventId: () => string
  readonly recordedAt?: () => string
  readonly step?: RunStepOptions
}

export const makeEmbeddedSessionRuntime = (
  options: EmbeddedSessionRuntimeOptions,
) =>
  Effect.gen(function* () {
    const log = createMemoryEventLog({
      eventId: () => options.eventId(),
      recordedAt: () => options.recordedAt?.() ?? new Date().toISOString(),
    })
    const order = yield* Semaphore.make(1)
    const eventLog: EventLogService = {
      ...log,
      append: (events, appendOptions) =>
        order.withPermits(1)(
          log
            .append(events, appendOptions)
            .pipe(
              Effect.tap((commit) =>
                commit.duplicate
                  ? Effect.void
                  : options.onCommit(commit.events),
              ),
            ),
        ),
    }
    const config = createSessionAppConfig(
      createMemoryReactionOutboxStore<OutboxedReaction<RunStepRequest>>(),
      {},
      options.step,
    )
    // Conformance wants every registered Event covered by a scenario, and most
    // of the 49-event catalog is not ported: register the events the Slices use.
    const events = [
      ...new Map(
        Object.values(config.slices)
          .flatMap((slice) => eventsFor(slice, config.events))
          .map((definition) => [definition.type, definition]),
      ).values(),
    ]
    return yield* makeSpecterRuntime({ ...config, events }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(EventLog, eventLog),
          memorySliceStoreLayer,
          createImmediateReactionSchedulerLayer(),
        ),
      ),
    )
  })

export type EmbeddedSessionRuntime = Effect.Success<
  ReturnType<typeof makeEmbeddedSessionRuntime>
>

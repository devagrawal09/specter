import { join } from 'node:path'

import { createSpecterApp, EventLog } from '@specter-ts/core'
import { eventsFor } from '@specter-ts/core/testing'
import {
  createJsonlEventLog,
  createJsonlReactionOutboxStore,
  createJsonlSliceStoreLayer,
} from '@specter-ts/jsonl'
import { createImmediateReactionSchedulerLayer } from '@specter-ts/memory'
import type { OutboxedReaction } from '@specter-ts/reaction-outbox'
import { Effect, Layer, PubSub } from 'effect'

import {
  createSessionAppConfig,
  createSliceStoreLayer,
  type RunStepOutboxOptions,
} from './app.ts'
import type { RunStepRequest } from './features/session/run-step-reaction/impl.ts'
import { type Delta, DeltaChannel } from './plugins/delta-channel.ts'
import { Model } from './plugins/model.ts'
import type { RunStepOptions } from './plugins/run-step.ts'

export type JsonlSessionAppOptions = {
  // Everything durable lives here: events.jsonl, outbox.jsonl, slices/*.json.
  readonly directory: string
  readonly model: Model['Service']
  readonly deltas?: PubSub.PubSub<Delta>
  // Lease, heartbeat, backoff and shutdown wait of the step Plugin's outbox.
  readonly outbox?: RunStepOutboxOptions
  readonly step?: RunStepOptions
}

// The persistent twin of the memory composition used by scenario tests: the
// same Slices and Plugin over a JSONL Event Log, JSON Slice Stores and a JSONL
// Reaction outbox. Opening the same directory again is the restart: the Event
// Log and outbox take over a dead process's locks, the outbox releases the
// attempt that process left running, and the step Plugin resumes it.
export const openJsonlSessionApp = async (options: JsonlSessionAppOptions) => {
  const log = createJsonlEventLog({
    path: join(options.directory, 'events.jsonl'),
  })
  const outbox = createJsonlReactionOutboxStore<
    OutboxedReaction<RunStepRequest>
  >({
    path: join(options.directory, 'outbox.jsonl'),
  })
  try {
    const full = createSessionAppConfig(outbox, options.outbox, options.step)
    // As in the integration test: register the events the registered Slices
    // use, since most of the 49-event catalog is not ported yet.
    const events = [
      ...new Map(
        Object.values(full.slices)
          .flatMap((slice) => eventsFor(slice, full.events))
          .map((definition) => [definition.type, definition]),
      ).values(),
    ]
    const pubsub = options.deltas ?? Effect.runSync(PubSub.unbounded<Delta>())
    const app = await createSpecterApp(
      { ...full, events },
      Layer.mergeAll(
        Layer.succeed(EventLog, log),
        createSliceStoreLayer((tag, createState) =>
          createJsonlSliceStoreLayer(tag, createState, {
            directory: join(options.directory, 'slices'),
          }),
        ),
        createImmediateReactionSchedulerLayer(),
        Layer.succeed(Model, options.model),
        Layer.succeed(DeltaChannel, { pubsub }),
      ),
    )
    return {
      app,
      log,
      outbox,
      // Orderly shutdown: the worker stops claiming and waits for a running
      // attempt, then both files are closed.
      close: async () => {
        await app.close()
        outbox.close()
        log.close()
      },
    }
  } catch (cause) {
    outbox.close()
    log.close()
    throw cause
  }
}

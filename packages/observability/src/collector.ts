import type {
  RuntimeObservationBatch,
  RuntimeObservationAcknowledgement,
} from '@specter-ts/protocol'
import {
  createSpecterApp,
  type EventLogAdapter,
  type ReactionScheduler,
  type SpecterApp,
  type SpecterAppConfig,
  SpecterCommandRejectedError,
  type SliceStoreAdapter,
} from '@specter-ts/core'
import { immediateReactionScheduler } from '@specter-ts/memory'

import type {
  CollectedRuntimeObservation,
  CollectorState,
  RuntimeActivityFilter,
  RuntimeOverview,
  RuntimeTrace,
  RuntimeTraceFilter,
} from './collector-model'
import { createRuntimeActivity } from './features/runtime-activity/impl'
import { createRecordRuntimeObservations } from './features/runtime-observations/impl'
import { observabilityEventDefinitions } from './features/runtime-observations/events'
import { createRuntimeOverview } from './features/runtime-overview/impl'
import { createRuntimeTrace } from './features/runtime-trace/impl'

export type SpecterObservabilityCollectorOptions = {
  readonly eventLog: EventLogAdapter
  readonly store: SliceStoreAdapter<CollectorState>
  readonly schedule?: ReactionScheduler
  readonly now?: () => Date
}

export async function createSpecterObservabilityCollector(
  options: SpecterObservabilityCollectorOptions,
) {
  const now = options.now ?? (() => new Date())
  const recordRuntimeObservations = createRecordRuntimeObservations(
    options.store,
  )
  const runtimeOverview = createRuntimeOverview(options.store, now)
  const runtimeActivity = createRuntimeActivity(options.store)
  const runtimeTrace = createRuntimeTrace(options.store)
  const config = {
    events: observabilityEventDefinitions,
    eventLog: options.eventLog,
    schedule: options.schedule ?? immediateReactionScheduler,
    slices: [
      recordRuntimeObservations,
      runtimeOverview,
      runtimeActivity,
      runtimeTrace,
    ],
  } as const
  const app = (await createSpecterApp(config)) as SpecterApp<SpecterAppConfig>

  return {
    app,
    async ingest(batch: RuntimeObservationBatch) {
      try {
        const execution = await app.command({
          type: 'recordRuntimeObservations',
          payload: {
            requestId: batch.requestId,
            observations: batch.observations,
          },
        })
        return {
          protocolVersion: 1,
          kind: 'observations.ack',
          requestId: batch.requestId,
          accepted: execution.duplicate ? 0 : execution.events.length,
          duplicates: execution.duplicate
            ? batch.observations.length
            : batch.observations.length - execution.events.length,
        } satisfies RuntimeObservationAcknowledgement
      } catch (cause) {
        if (
          cause instanceof SpecterCommandRejectedError &&
          cause.message.endsWith('Command emitted no Events.')
        ) {
          return {
            protocolVersion: 1,
            kind: 'observations.ack',
            requestId: batch.requestId,
            accepted: 0,
            duplicates: batch.observations.length,
          } satisfies RuntimeObservationAcknowledgement
        }
        throw cause
      }
    },
    overview() {
      return app.query({
        type: 'runtimeOverview',
        payload: {},
      }) as Promise<RuntimeOverview>
    },
    activity(filter: RuntimeActivityFilter = {}) {
      return app.query({
        type: 'runtimeActivity',
        payload: { limit: 100, ...filter },
      }) as Promise<readonly CollectedRuntimeObservation[]>
    },
    trace(operationId: string, filter: RuntimeTraceFilter = {}) {
      return app.query({
        type: 'runtimeTrace',
        payload: { operationId, ...filter },
      }) as Promise<RuntimeTrace>
    },
    subscribeActivity(
      filter: RuntimeActivityFilter = {},
      subscriptionOptions: { readonly signal?: AbortSignal } = {},
    ) {
      return app.subscribe(
        {
          type: 'runtimeActivity',
          payload: { limit: 100, ...filter },
        },
        subscriptionOptions,
      ) as AsyncIterable<readonly CollectedRuntimeObservation[]>
    },
  }
}

export type SpecterObservabilityCollector = Awaited<
  ReturnType<typeof createSpecterObservabilityCollector>
>

import type {
  RuntimeObservationBatch,
  RuntimeObservationAcknowledgement,
  SpecificationAcknowledgement,
  SpecificationPublication,
} from '@specter-ts/protocol'
import {
  createSpecterApp,
  EventLog,
  type EventLogService,
  ReactionScheduler,
  type ReactionSchedulerService,
  type SliceStoreService,
  SpecterCommandRejectedError,
} from '@specter-ts/core'
import { Layer } from 'effect'

import type {
  CollectedRuntimeObservation,
  CollectorState,
  RuntimeActivityFilter,
  RuntimeOverview,
  RuntimeTrace,
  RuntimeTraceFilter,
} from './collector-model'
import { CollectorStore } from './collector-store'
import { runtimeActivity } from './features/runtime-activity/impl'
import { recordRuntimeObservations } from './features/runtime-observations/impl'
import { observabilityEventDefinitions } from './features/runtime-observations/events'
import { runtimeOverview } from './features/runtime-overview/impl'
import { runtimeTrace } from './features/runtime-trace/impl'
import {
  createMemorySpecificationCatalog,
  type SpecificationCatalog,
  type SpecificationFilter,
} from './specification-catalog'

export type SpecterObservabilityCollectorOptions = {
  readonly eventLog: EventLogService
  readonly store: SliceStoreService<CollectorState, CollectorState, unknown>
  readonly scheduler?: ReactionSchedulerService
  readonly now?: () => Date
  readonly specifications?: SpecificationCatalog
}

export async function createSpecterObservabilityCollector(
  options: SpecterObservabilityCollectorOptions,
) {
  const now = options.now ?? (() => new Date())
  const specifications =
    options.specifications ?? createMemorySpecificationCatalog()
  const config = {
    events: observabilityEventDefinitions,
    slices: {
      recordRuntimeObservations,
      runtimeOverview,
      runtimeActivity,
      runtimeTrace,
    },
  } as const
  const schedulerLayer = options.scheduler
    ? Layer.succeed(ReactionScheduler, options.scheduler)
    : Layer.empty
  const dependencies = Layer.mergeAll(
    Layer.succeed(EventLog, options.eventLog),
    schedulerLayer,
    Layer.succeed(CollectorStore, options.store),
  )
  const app = await createSpecterApp(config, dependencies)

  return {
    app,
    async ingest(batch: RuntimeObservationBatch) {
      if (batch.observations.length === 0) {
        return {
          protocolVersion: 1,
          kind: 'observations.ack',
          requestId: batch.requestId,
          accepted: 0,
          duplicates: 0,
        } satisfies RuntimeObservationAcknowledgement
      }
      try {
        const execution = await app.command({
          type: 'recordRuntimeObservations',
          payload: {
            requestId: batch.requestId,
            observations: [...batch.observations],
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
    async publishSpecifications(publication: SpecificationPublication) {
      const acceptedDigests = await specifications.publish(publication, now())
      return {
        protocolVersion: 1,
        kind: 'specifications.ack',
        requestId: publication.requestId,
        acceptedDigests,
      } satisfies SpecificationAcknowledgement
    },
    specifications(filter: SpecificationFilter = {}) {
      return specifications.list(filter)
    },
    pruneSpecifications(digests: readonly `sha256:${string}`[]) {
      return specifications.prune(digests)
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

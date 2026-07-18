import type { SliceStoreAdapter } from '@specter-ts/core'
import type { RuntimeObservation } from '@specter-ts/protocol'
import { z } from 'zod'

import type {
  CollectedRuntimeObservation,
  CollectorState,
} from '../../collector-model'
import { runtimeObservationIdentity } from '../../collector-model'
import { runtimeObservationRecordedEvent } from '../runtime-observations/events'
import { runtimeActivitySpec } from './spec'

export function createRuntimeActivity(
  store: SliceStoreAdapter<CollectorState>,
) {
  return runtimeActivitySpec
    .inputSchema(
      z.object({
        application: z.string().min(1).optional(),
        environment: z.string().min(1).optional(),
        instanceId: z.string().min(1).optional(),
        eventLogId: z.string().min(1).optional(),
        kind: z.string().min(1).optional(),
        operationId: z.string().min(1).optional(),
        correlationId: z.string().min(1).optional(),
        slice: z.string().min(1).optional(),
        reaction: z.string().min(1).optional(),
        afterSequence: z.number().int().nonnegative().optional(),
        afterCollectorOrder: z.number().int().nonnegative().optional(),
        limit: z.number().int().min(1).max(500).catch(100),
      }),
    )
    .outputSchema<readonly CollectedRuntimeObservation[]>()
    .store(store)
    .apply(runtimeObservationRecordedEvent, async (event, state) => {
      const observation = event.payload.observation as RuntimeObservation
      const identity = runtimeObservationIdentity(observation)
      if (state.observationIds[identity]) return
      state.observationIds[identity] = true
      state.observations.push({
        ...observation,
        collectorOrder: (event as typeof event & { readonly order: number })
          .order,
      })
    })
    .handle(async (query, state) =>
      state.observations
        .filter(
          (item) =>
            item.collectorOrder > (query.afterCollectorOrder ?? 0) &&
            (!query.application ||
              item.source.application === query.application) &&
            (!query.environment ||
              item.source.environment === query.environment) &&
            (!query.instanceId ||
              item.source.instanceId === query.instanceId) &&
            (!query.eventLogId ||
              item.source.eventLogId === query.eventLogId) &&
            (!query.kind || item.kind === query.kind) &&
            (!query.operationId || item.operationId === query.operationId) &&
            (!query.correlationId ||
              item.correlationId === query.correlationId) &&
            (!query.slice || item.slice === query.slice) &&
            (!query.reaction || item.reaction === query.reaction) &&
            item.sequence > (query.afterSequence ?? 0),
        )
        .slice(-query.limit)
        .map((item) => structuredClone(item)),
    )
}

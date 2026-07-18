import type { SliceStoreAdapter } from '@specter-ts/core'
import type { RuntimeObservation } from '@specter-ts/protocol'
import { z } from 'zod'

import type {
  CollectorState,
  RuntimeTrace,
  RuntimeTraceEdge,
} from '../../collector-model'
import { runtimeObservationIdentity } from '../../collector-model'
import { runtimeObservationRecordedEvent } from '../runtime-observations/events'
import { runtimeTraceSpec } from './spec'

export function createRuntimeTrace(store: SliceStoreAdapter<CollectorState>) {
  return runtimeTraceSpec
    .inputSchema(z.object({ operationId: z.string().min(1) }))
    .outputSchema<RuntimeTrace>()
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
    .handle(async ({ operationId }, state) => {
      const producerByEvent = new Map<string, string>()
      for (const observation of state.observations) {
        for (const event of observation.events ?? []) {
          producerByEvent.set(event.eventId, observation.operationId)
        }
      }

      const operationIds = new Set([operationId])
      let changed = true
      while (changed) {
        changed = false
        for (const observation of state.observations) {
          const parents = observation.parentOperationIds ?? []
          const eventParents = (observation.triggeringEventIds ?? [])
            .map((eventId) => producerByEvent.get(eventId))
            .filter((parent): parent is string => parent !== undefined)
          const causes = [...parents, ...eventParents]
          if (operationIds.has(observation.operationId)) {
            for (const cause of causes) {
              if (!operationIds.has(cause)) {
                operationIds.add(cause)
                changed = true
              }
            }
          } else if (causes.some((cause) => operationIds.has(cause))) {
            operationIds.add(observation.operationId)
            changed = true
          }
        }
      }

      const observations = state.observations
        .filter((observation) => operationIds.has(observation.operationId))
        .map((observation) => structuredClone(observation))
      const edges: RuntimeTraceEdge[] = []
      const edgeKeys = new Set<string>()
      for (const observation of observations) {
        for (const parent of observation.parentOperationIds ?? []) {
          const key = `${parent}\u0000${observation.operationId}\u0000parent`
          if (!operationIds.has(parent) || edgeKeys.has(key)) continue
          edgeKeys.add(key)
          edges.push({
            from: parent,
            to: observation.operationId,
            relation: 'parent-operation',
          })
        }
        for (const eventId of observation.triggeringEventIds ?? []) {
          const producer = producerByEvent.get(eventId)
          if (!producer || !operationIds.has(producer)) continue
          const key = `${producer}\u0000${observation.operationId}\u0000event`
          if (edgeKeys.has(key)) continue
          edgeKeys.add(key)
          edges.push({
            from: producer,
            to: observation.operationId,
            relation: 'caused-by-event',
          })
        }
      }

      return { operationId, observations, edges }
    })
}

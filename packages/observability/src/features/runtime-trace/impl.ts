import type { SliceStoreAdapter } from '@specter-ts/core'
import type { RuntimeObservation } from '@specter-ts/protocol'
import { z } from 'zod'

import type {
  CollectorState,
  RuntimeTrace,
  RuntimeTraceEdge,
  RuntimeTraceFilter,
} from '../../collector-model'
import {
  runtimeEventLogIdentity,
  runtimeObservationIdentity,
  runtimeSourceIdentity,
} from '../../collector-model'
import { runtimeObservationRecordedEvent } from '../runtime-observations/events'
import { runtimeTraceSpec } from './spec'

export function createRuntimeTrace(store: SliceStoreAdapter<CollectorState>) {
  return runtimeTraceSpec
    .inputSchema(
      z.object({
        operationId: z.string().min(1),
        application: z.string().min(1).optional(),
        environment: z.string().min(1).optional(),
        instanceId: z.string().min(1).optional(),
        eventLogId: z.string().min(1).optional(),
      }),
    )
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
    .handle(async ({ operationId, ...sourceFilter }, state) => {
      const operationKey = (
        observation: Pick<RuntimeObservation, 'source' | 'operationId'>,
        id = observation.operationId,
      ) => `${runtimeSourceIdentity(observation.source)}\u0000${id}`
      const eventKey = (
        observation: Pick<RuntimeObservation, 'source'>,
        eventId: string,
      ) => `${runtimeEventLogIdentity(observation.source)}\u0000${eventId}`
      const producerByEvent = new Map<
        string,
        { readonly key: string; readonly operationId: string }
      >()
      for (const observation of state.observations) {
        for (const event of observation.events ?? []) {
          producerByEvent.set(eventKey(observation, event.eventId), {
            key: operationKey(observation),
            operationId: observation.operationId,
          })
        }
      }

      const operationKeys = new Set(
        state.observations
          .filter(
            (observation) =>
              observation.operationId === operationId &&
              matchesSource(observation.source, sourceFilter),
          )
          .map((observation) => operationKey(observation)),
      )
      let changed = true
      while (changed) {
        changed = false
        for (const observation of state.observations) {
          const currentOperationKey = operationKey(observation)
          const parents = (observation.parentOperationIds ?? []).map((parent) =>
            operationKey(observation, parent),
          )
          const eventParents = (observation.triggeringEventIds ?? [])
            .map((eventId) =>
              producerByEvent.get(eventKey(observation, eventId)),
            )
            .filter((parent) => parent !== undefined)
            .map((parent) => parent.key)
          const causes = [...parents, ...eventParents]
          if (operationKeys.has(currentOperationKey)) {
            for (const cause of causes) {
              if (!operationKeys.has(cause)) {
                operationKeys.add(cause)
                changed = true
              }
            }
          } else if (causes.some((cause) => operationKeys.has(cause))) {
            operationKeys.add(currentOperationKey)
            changed = true
          }
        }
      }

      const observations = state.observations
        .filter((observation) => operationKeys.has(operationKey(observation)))
        .map((observation) => structuredClone(observation))
      const edges: RuntimeTraceEdge[] = []
      const edgeKeys = new Set<string>()
      for (const observation of observations) {
        const currentOperationKey = operationKey(observation)
        for (const parent of observation.parentOperationIds ?? []) {
          const parentKey = operationKey(observation, parent)
          const key = `${parentKey}\u0000${currentOperationKey}\u0000parent`
          if (!operationKeys.has(parentKey) || edgeKeys.has(key)) continue
          edgeKeys.add(key)
          edges.push({
            from: parent,
            to: observation.operationId,
            relation: 'parent-operation',
          })
        }
        for (const eventId of observation.triggeringEventIds ?? []) {
          const producer = producerByEvent.get(eventKey(observation, eventId))
          if (!producer || !operationKeys.has(producer.key)) continue
          const key = `${producer.key}\u0000${currentOperationKey}\u0000event`
          if (edgeKeys.has(key)) continue
          edgeKeys.add(key)
          edges.push({
            from: producer.operationId,
            to: observation.operationId,
            relation: 'caused-by-event',
          })
        }
      }

      return { operationId, observations, edges }
    })
}

function matchesSource(
  source: RuntimeObservation['source'],
  filter: RuntimeTraceFilter,
) {
  return (
    (!filter.application || source.application === filter.application) &&
    (!filter.environment || source.environment === filter.environment) &&
    (!filter.instanceId || source.instanceId === filter.instanceId) &&
    (!filter.eventLogId || source.eventLogId === filter.eventLogId)
  )
}

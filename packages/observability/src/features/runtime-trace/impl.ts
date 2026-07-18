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
      const logicalOperationKey = (
        observation: Pick<RuntimeObservation, 'source'>,
        id: string,
      ) => `${runtimeEventLogIdentity(observation.source)}\u0000${id}`
      const eventKey = (
        observation: Pick<RuntimeObservation, 'source'>,
        eventId: string,
      ) => `${runtimeEventLogIdentity(observation.source)}\u0000${eventId}`
      const producerByEvent = new Map<
        string,
        { readonly key: string; readonly operationId: string } | null
      >()
      const operationsByLogicalId = new Map<string, Set<string>>()
      for (const observation of state.observations) {
        const currentOperationKey = operationKey(observation)
        const logicalKey = logicalOperationKey(
          observation,
          observation.operationId,
        )
        const operationCandidates = operationsByLogicalId.get(logicalKey)
        if (operationCandidates) operationCandidates.add(currentOperationKey)
        else
          operationsByLogicalId.set(logicalKey, new Set([currentOperationKey]))
        for (const event of observation.events ?? []) {
          const key = eventKey(observation, event.eventId)
          const existing = producerByEvent.get(key)
          const producer = {
            key: currentOperationKey,
            operationId: observation.operationId,
          }
          producerByEvent.set(
            key,
            existing === null || (existing && existing.key !== producer.key)
              ? null
              : producer,
          )
        }
      }

      const resolveParent = (observation: RuntimeObservation, id: string) => {
        const candidates = operationsByLogicalId.get(
          logicalOperationKey(observation, id),
        )
        return candidates?.size === 1 ? [...candidates][0] : undefined
      }
      const identityLinks = buildIdentityLinks(state.observations, operationKey)
      const linkedOperations = new Map<string, Set<string>>()
      for (const link of identityLinks) {
        addLink(linkedOperations, link.fromKey, link.toKey)
        addLink(linkedOperations, link.toKey, link.fromKey)
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
          const parents = (observation.parentOperationIds ?? [])
            .map((parent) => resolveParent(observation, parent))
            .filter((parent) => parent !== undefined)
          const eventParents = (observation.triggeringEventIds ?? [])
            .map((eventId) =>
              producerByEvent.get(eventKey(observation, eventId)),
            )
            .filter((parent) => parent !== undefined && parent !== null)
            .map((parent) => parent.key)
          const causes = [...parents, ...eventParents]
          const links = [...(linkedOperations.get(currentOperationKey) ?? [])]
          if (operationKeys.has(currentOperationKey)) {
            for (const related of [...causes, ...links]) {
              if (!operationKeys.has(related)) {
                operationKeys.add(related)
                changed = true
              }
            }
          } else if (
            [...causes, ...links].some((related) => operationKeys.has(related))
          ) {
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
          const parentKey = resolveParent(observation, parent)
          if (!parentKey) continue
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
      for (const link of identityLinks) {
        if (
          !operationKeys.has(link.fromKey) ||
          !operationKeys.has(link.toKey)
        ) {
          continue
        }
        const key = `${link.fromKey}\u0000${link.toKey}\u0000${link.relation}`
        if (edgeKeys.has(key)) continue
        edgeKeys.add(key)
        edges.push({
          from: link.fromOperationId,
          to: link.toOperationId,
          relation: link.relation,
        })
      }

      return { operationId, observations, edges }
    })
}

type TraceIdentityRelation = 'reaction-pass' | 'delivery' | 'attempt'

type TraceIdentityLink = {
  readonly fromKey: string
  readonly toKey: string
  readonly fromOperationId: string
  readonly toOperationId: string
  readonly relation: TraceIdentityRelation
}

function buildIdentityLinks(
  observations: readonly (RuntimeObservation & {
    readonly collectorOrder: number
  })[],
  operationKey: (observation: RuntimeObservation) => string,
) {
  const groups = new Map<
    string,
    {
      readonly relation: TraceIdentityRelation
      readonly operations: Map<
        string,
        { readonly operationId: string; readonly collectorOrder: number }
      >
    }
  >()
  for (const observation of observations) {
    for (const [relation, identity] of [
      ['reaction-pass', observation.reactionPassId],
      ['delivery', observation.deliveryId],
      ['attempt', observation.attemptId],
    ] as const) {
      if (!identity) continue
      const groupKey = `${runtimeEventLogIdentity(observation.source)}\u0000${relation}\u0000${identity}`
      let group = groups.get(groupKey)
      if (!group) {
        group = { relation, operations: new Map() }
        groups.set(groupKey, group)
      }
      const key = operationKey(observation)
      if (!group.operations.has(key)) {
        group.operations.set(key, {
          operationId: observation.operationId,
          collectorOrder: observation.collectorOrder,
        })
      }
    }
  }

  const links: TraceIdentityLink[] = []
  for (const group of groups.values()) {
    const operations = [...group.operations.entries()].sort(
      (left, right) => left[1].collectorOrder - right[1].collectorOrder,
    )
    for (let index = 1; index < operations.length; index += 1) {
      const previous = operations[index - 1]
      const current = operations[index]
      if (!previous || !current) continue
      links.push({
        fromKey: previous[0],
        toKey: current[0],
        fromOperationId: previous[1].operationId,
        toOperationId: current[1].operationId,
        relation: group.relation,
      })
    }
  }
  return links
}

function addLink(links: Map<string, Set<string>>, from: string, to: string) {
  const existing = links.get(from)
  if (existing) existing.add(to)
  else links.set(from, new Set([to]))
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

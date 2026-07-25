import { implementQuery } from '@specter-ts/core'
import type { RuntimeObservation } from '@specter-ts/protocol'
import { z } from 'zod'

import {
  copyCollectorState,
  runtimeObservationIdentity,
  summarizeRuntimeExecutions,
  type RuntimeOverview,
  type RuntimeSourceSummary,
} from '../../collector-model'
import { CollectorStore } from '../../collector-store'
import { runtimeObservationRecordedEvent } from '../runtime-observations/events'
import specification from './spec.json' with { type: 'json' }

const failed = (kind: string, outcome?: string) =>
  outcome === 'failed' ||
  kind.includes('failed') ||
  kind.includes('dead-letter')

const rejected = (kind: string, outcome?: string) =>
  outcome === 'rejected' || kind.includes('rejected')

const sourceKey = (source: RuntimeSourceSummary['source']) =>
  [
    source.application,
    source.environment,
    source.runtimeLanguage,
    source.runtimeVersion,
    source.instanceId,
    source.eventLogId,
  ].join('\u0000')

export const runtimeOverview = implementQuery(specification)
  .inputSchema(z.object({}))
  .outputSchema<RuntimeOverview>()
  .store(CollectorStore)
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
  .handle(async (_query, state) => {
    const summaries = new Map<string, RuntimeSourceSummary>()
    const sourceEventOrders = new Map<string, number>()
    const sourceCursors = new Map<string, number>()
    const executionObservations = new Map<
      string,
      Map<string, RuntimeObservation[]>
    >()
    const kinds: Record<string, number> = {}
    let failureCount = 0
    let rejectionCount = 0
    let droppedObservationCount = 0

    for (const observation of state.observations) {
      const isFailure = failed(observation.kind, observation.outcome)
      const isRejection = rejected(observation.kind, observation.outcome)
      if (isFailure) failureCount += 1
      if (isRejection) rejectionCount += 1
      const dropped = observation.droppedCount ?? 0
      droppedObservationCount += dropped
      kinds[observation.kind] = (kinds[observation.kind] ?? 0) + 1

      const key = sourceKey(observation.source)
      if (observation.specificationDigest) {
        const bySpecification =
          executionObservations.get(key) ??
          new Map<string, RuntimeObservation[]>()
        const observations =
          bySpecification.get(observation.specificationDigest) ?? []
        observations.push(observation)
        bySpecification.set(observation.specificationDigest, observations)
        executionObservations.set(key, bySpecification)
      }
      const eventOrder = Math.max(
        sourceEventOrders.get(key) ?? 0,
        ...(observation.events ?? []).map((event) => event.order),
      )
      const cursor = Math.max(
        sourceCursors.get(key) ?? 0,
        observation.cursor ?? 0,
      )
      sourceEventOrders.set(key, eventOrder)
      sourceCursors.set(key, cursor)
      const previous = summaries.get(key)
      summaries.set(key, {
        source: observation.source,
        observationCount: (previous?.observationCount ?? 0) + 1,
        failureCount: (previous?.failureCount ?? 0) + (isFailure ? 1 : 0),
        rejectionCount: (previous?.rejectionCount ?? 0) + (isRejection ? 1 : 0),
        droppedObservationCount:
          (previous?.droppedObservationCount ?? 0) + dropped,
        lastSequence: Math.max(
          previous?.lastSequence ?? 0,
          observation.sequence,
        ),
        lastObservedAt:
          !previous || observation.observedAt > previous.lastObservedAt
            ? observation.observedAt
            : previous.lastObservedAt,
        projectionLag: Math.max(0, eventOrder - cursor),
        executionsBySpecification: {},
      })
    }

    const copied = copyCollectorState(state)
    return {
      generatedAt:
        copied.observations.at(-1)?.observedAt ?? new Date(0).toISOString(),
      collectorVersion: copied.observations.at(-1)?.collectorOrder ?? 0,
      observationCount: copied.observations.length,
      failureCount,
      rejectionCount,
      droppedObservationCount,
      sources: [...summaries.entries()]
        .map(([key, summary]) => ({
          ...summary,
          executionsBySpecification: Object.fromEntries(
            [...(executionObservations.get(key) ?? [])].map(
              ([digest, observations]) => [
                digest,
                summarizeRuntimeExecutions(observations),
              ],
            ),
          ),
        }))
        .sort((left, right) =>
          sourceKey(left.source).localeCompare(sourceKey(right.source)),
        ),
      kinds,
      recent: copied.observations.slice(-100),
    }
  })

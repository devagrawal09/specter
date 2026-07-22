import type { RuntimeObservation } from '@specter-ts/protocol'
import { describe, expect, it } from 'vitest'

import {
  applicationRuntimeGroups,
  executionSummary,
  observationMatchesScope,
  runtimeSourceIdentity,
  summarizeRuntimeScope,
} from './dashboard-model'

const source = {
  application: 'todo',
  environment: 'test',
  runtimeLanguage: 'typescript',
  runtimeVersion: '0.4.0',
  instanceId: 'instance-1',
  eventLogId: 'log-1',
}

function observation(
  kind: RuntimeObservation['kind'],
  operationId: string,
  outcome?: RuntimeObservation['outcome'],
  deliveryId?: string,
): RuntimeObservation {
  return {
    observationId: `${operationId}:${kind}`,
    sequence: 1,
    observedAt: '2026-07-22T12:00:00.000Z',
    source,
    kind,
    operationId,
    ...(outcome ? { outcome } : {}),
    ...(deliveryId ? { deliveryId } : {}),
  }
}

describe('dashboard execution summary', () => {
  it('counts terminal operations instead of every lifecycle observation', () => {
    const observations = [
      observation('command.started', 'command-1'),
      observation('events.persisted', 'command-1', 'succeeded'),
      observation('command.completed', 'command-1', 'succeeded'),
      observation('query.started', 'query-1'),
      observation('query.failed', 'query-1', 'failed'),
      observation('reaction.run.started', 'reaction-1'),
    ]

    expect(executionSummary(observations)).toEqual({
      executions: 2,
      failures: 1,
      rejections: 0,
    })
  })

  it('reports expected business rejections separately from failures', () => {
    const observations = [
      observation('command.rejected', 'command-1', 'rejected'),
      observation('query.failed', 'query-1', 'failed'),
    ]

    expect(executionSummary(observations)).toEqual({
      executions: 2,
      failures: 1,
      rejections: 1,
    })
  })

  it('counts retries of one Reaction delivery as one execution', () => {
    const observations = [
      observation(
        'reaction.run.failed',
        'reaction-attempt-1',
        'failed',
        'publishValue:4',
      ),
      observation(
        'reaction.run.completed',
        'reaction-attempt-2',
        'succeeded',
        'publishValue:4',
      ),
    ]

    expect(executionSummary(observations)).toEqual({
      executions: 1,
      failures: 0,
      rejections: 0,
    })
  })
})

describe('dashboard runtime scope', () => {
  const productionSource = { ...source, environment: 'production' }
  const secondSource = { ...productionSource, instanceId: 'instance-2' }

  it('matches application, environment, source, and specification digest', () => {
    const item = {
      ...observation('command.completed', 'command-1', 'succeeded'),
      source: productionSource,
      specificationDigest: 'sha256:one' as const,
    }

    expect(
      observationMatchesScope(
        item,
        {
          application: 'todo',
          environment: 'production',
          source: runtimeSourceIdentity(productionSource),
        },
        'sha256:one',
      ),
    ).toBe(true)
    expect(
      observationMatchesScope(
        item,
        { application: 'todo', environment: 'test' },
        'sha256:one',
      ),
    ).toBe(false)
    expect(
      observationMatchesScope(
        item,
        {
          application: 'todo',
          environment: 'production',
          source: runtimeSourceIdentity(secondSource),
        },
        'sha256:one',
      ),
    ).toBe(false)
  })

  it('summarizes only sources in the selected scope', () => {
    expect(
      summarizeRuntimeScope(
        {
          generatedAt: '2026-07-22T12:00:00.000Z',
          collectorVersion: 4,
          observationCount: 15,
          failureCount: 2,
          rejectionCount: 3,
          droppedObservationCount: 4,
          kinds: {},
          recent: [],
          sources: [
            {
              source: productionSource,
              observationCount: 10,
              failureCount: 1,
              rejectionCount: 2,
              droppedObservationCount: 3,
              lastSequence: 10,
              lastObservedAt: '2026-07-22T12:00:00.000Z',
              projectionLag: 5,
            },
            {
              source: { ...source, application: 'booking' },
              observationCount: 5,
              failureCount: 1,
              rejectionCount: 1,
              droppedObservationCount: 1,
              lastSequence: 5,
              lastObservedAt: '2026-07-22T11:00:00.000Z',
              projectionLag: 99,
            },
          ],
        },
        { application: 'todo', environment: 'production' },
      ),
    ).toEqual({
      observations: 10,
      failures: 1,
      rejections: 2,
      dropped: 3,
      maxProjectionLag: 5,
      lastObservedAt: '2026-07-22T12:00:00.000Z',
    })
  })

  it('groups specifications and signals by application and environment', () => {
    const document = {
      $schema:
        'https://specter.dev/specification/v1/slice.schema.json' as const,
      formatVersion: 1 as const,
      kind: 'query' as const,
      name: 'todosQuery',
      description: 'Lists todos.',
      scenarios: [
        { description: 'Lists none.', given: [], when: {}, expect: [] },
      ] as const,
    }
    const groups = applicationRuntimeGroups(
      [
        {
          digest: 'sha256:one',
          document,
          firstPublishedAt: '2026-07-22T12:00:00.000Z',
          sources: [productionSource],
        },
      ],
      {
        generatedAt: '2026-07-22T12:00:00.000Z',
        collectorVersion: 1,
        observationCount: 1,
        failureCount: 0,
        rejectionCount: 0,
        droppedObservationCount: 0,
        kinds: {},
        recent: [],
        sources: [
          {
            source: productionSource,
            observationCount: 1,
            failureCount: 0,
            rejectionCount: 0,
            droppedObservationCount: 0,
            lastSequence: 1,
            lastObservedAt: '2026-07-22T12:00:00.000Z',
            projectionLag: 0,
          },
        ],
      },
    )

    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({
      application: 'todo',
      environment: 'production',
      sourceCount: 1,
      summary: { observations: 1 },
    })
    expect(groups[0]?.specifications[0]?.document.name).toBe('todosQuery')
  })
})

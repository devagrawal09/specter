import type { RuntimeObservation } from '@specter-ts/protocol'
import { describe, expect, it } from 'vitest'

import {
  applicationEnvironmentCountLabel,
  applicationRuntimeGroups,
  dashboardHealthMessage,
  executionSummary,
  mergeRecentRuntimeActivity,
  observationMatchesScope,
  relativeRuntimeTime,
  runtimeFreshnessWindowMs,
  runtimeSignalStatus,
  runtimeSourceIdentity,
  summarizeSpecificationRuntimeScope,
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
              executionsBySpecification: {
                'sha256:one': {
                  executions: 4,
                  failures: 1,
                  rejections: 2,
                },
              },
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
              executionsBySpecification: {},
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
            executionsBySpecification: {},
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
    expect(applicationEnvironmentCountLabel).toBe('App environments')
  })

  it('summarizes exact all-history executions for one digest and scope', () => {
    const overview = {
      generatedAt: '2026-07-22T12:00:00.000Z',
      collectorVersion: 201,
      observationCount: 201,
      failureCount: 1,
      rejectionCount: 2,
      droppedObservationCount: 0,
      kinds: {},
      recent: [],
      sources: [
        {
          source: productionSource,
          observationCount: 201,
          failureCount: 1,
          rejectionCount: 2,
          droppedObservationCount: 0,
          lastSequence: 201,
          lastObservedAt: '2026-07-22T12:00:00.000Z',
          projectionLag: 0,
          executionsBySpecification: {
            'sha256:one': {
              executions: 7,
              failures: 1,
              rejections: 2,
            },
            'sha256:other': {
              executions: 194,
              failures: 0,
              rejections: 0,
            },
          },
        },
      ],
    }

    expect(
      summarizeSpecificationRuntimeScope(
        overview,
        { application: 'todo', environment: 'production' },
        'sha256:one',
      ),
    ).toEqual({ executions: 7, failures: 1, rejections: 2 })
  })
})

describe('dashboard freshness and health', () => {
  const lastObservedAt = '2026-07-22T12:00:00.000Z'
  const observedAt = Date.parse(lastObservedAt)
  const summary = {
    observations: 1,
    failures: 0,
    rejections: 0,
    dropped: 0,
    maxProjectionLag: 0,
    lastObservedAt,
  }

  it('ages active evidence into an unknown state while the page is idle', () => {
    expect(
      runtimeSignalStatus(summary, observedAt + runtimeFreshnessWindowMs - 1),
    ).toEqual({ label: 'Active', tone: 'active' })
    expect(
      runtimeSignalStatus(summary, observedAt + runtimeFreshnessWindowMs + 1),
    ).toEqual({ label: 'No recent evidence', tone: 'unknown' })
    expect(
      relativeRuntimeTime(lastObservedAt, observedAt + 16 * 60 * 1000),
    ).toBe('16m ago')
  })

  it('keeps refresh and stream failures visible with stale-data context', () => {
    expect(
      dashboardHealthMessage(
        'Overview request failed.',
        'Live updates disconnected.',
        observedAt,
        observedAt + 60_000,
      ),
    ).toEqual({
      title: 'Runtime signals may be stale',
      detail:
        'Overview request failed. Live updates disconnected. Last successful refresh 1m ago.',
    })
  })
})

describe('dashboard live activity identity', () => {
  it('does not collapse the same observation ID from distinct sources', () => {
    const first = {
      ...observation('command.completed', 'operation-1', 'succeeded'),
      observationId: 'shared-id',
      collectorOrder: 1,
    }
    const second = {
      ...first,
      collectorOrder: 2,
      source: { ...source, runtimeVersion: '0.5.0' },
    }

    expect(mergeRecentRuntimeActivity([first], second)).toEqual([first, second])
    expect(
      mergeRecentRuntimeActivity([first, second], {
        ...first,
        collectorOrder: 3,
      }),
    ).toEqual([second, { ...first, collectorOrder: 3 }])
  })
})

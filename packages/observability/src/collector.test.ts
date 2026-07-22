import { describe, expect, it } from 'vitest'
import type {
  RuntimeObservation,
  RuntimeObservationAcknowledgement,
  RuntimeObservationBatch,
  RuntimeSource,
} from '@specter-ts/protocol'
import {
  createMemoryEventLog,
  createMemorySliceStoreService,
} from '@specter-ts/memory'
import type {
  ReactionOutboxClaim,
  ReactionOutboxJob,
} from '@specter-ts/reaction-outbox'
import { Effect } from 'effect'

import { copyCollectorState, createCollectorState } from './collector-model'
import { createSpecterObservabilityCollector } from './collector'
import { createSpecterObservabilityHttpHandler } from './http-handler'
import { createRuntimeObservationProducer } from './producer'
import { createRuntimeObservationEmitter } from './runtime-adapter'

const source: RuntimeSource = {
  application: 'todo-reference',
  environment: 'development',
  runtimeLanguage: 'typescript',
  runtimeVersion: '0.4.0',
  instanceId: 'instance-1',
  eventLogId: 'todo-log',
}

const eventReference = {
  eventId: 'todo-added-1',
  type: 'todo-added',
  order: 1,
  recordedAt: '2026-07-18T12:00:00.000Z',
  commitVersion: 1,
}

function observation(
  input: Partial<RuntimeObservation> &
    Pick<
      RuntimeObservation,
      'observationId' | 'sequence' | 'kind' | 'operationId'
    >,
): RuntimeObservation {
  return {
    observedAt: '2026-07-18T12:00:00.000Z',
    source,
    ...input,
  }
}

function batch(
  requestId: string,
  observations: readonly RuntimeObservation[],
): RuntimeObservationBatch {
  return {
    protocolVersion: 1,
    kind: 'observations.batch',
    requestId,
    observations,
  }
}

function acknowledgement(
  input: RuntimeObservationBatch,
  overrides: Partial<RuntimeObservationAcknowledgement> = {},
) {
  return Response.json({
    protocolVersion: 1,
    kind: 'observations.ack',
    requestId: input.requestId,
    accepted: input.observations.length,
    duplicates: 0,
    ...overrides,
  } satisfies RuntimeObservationAcknowledgement)
}

async function setup() {
  const eventLog = createMemoryEventLog()
  const store = createMemorySliceStoreService(createCollectorState, {
    clone: copyCollectorState,
  })
  const collector = await createSpecterObservabilityCollector({
    eventLog,
    store,
    now: () => new Date('2026-07-18T12:00:01.000Z'),
  })
  return { collector, eventLog }
}

describe('Specter observability collector', () => {
  it('persists observations and builds overview, activity, and causal traces', async () => {
    const { collector } = await setup()
    const parent = observation({
      observationId: 'observation-1',
      sequence: 1,
      kind: 'command.completed',
      operationId: 'command-1',
      outcome: 'succeeded',
      commandType: 'addTodo',
      events: [eventReference],
    })
    const child = observation({
      observationId: 'observation-2',
      sequence: 2,
      kind: 'reaction.run.failed',
      operationId: 'reaction-1',
      outcome: 'failed',
      reaction: 'todoCheer',
      parentOperationIds: ['command-1'],
      triggeringEventIds: ['todo-added-1'],
      error: { code: 'REACTION_FAILED', message: 'offline' },
    })

    await expect(
      collector.ingest(batch('batch-1', [parent, child])),
    ).resolves.toMatchObject({
      kind: 'observations.ack',
      accepted: 2,
      duplicates: 0,
    })
    await expect(collector.overview()).resolves.toMatchObject({
      collectorVersion: 2,
      observationCount: 2,
      failureCount: 1,
      sources: [{ observationCount: 2, failureCount: 1 }],
    })
    await expect(
      collector.activity({
        application: 'todo-reference',
        kind: 'reaction.run.failed',
      }),
    ).resolves.toMatchObject([
      { observationId: 'observation-2', collectorOrder: 2 },
    ])
    await expect(collector.trace('reaction-1')).resolves.toMatchObject({
      observations: [
        { operationId: 'command-1' },
        { operationId: 'reaction-1' },
      ],
      edges: [
        { from: 'command-1', to: 'reaction-1', relation: 'parent-operation' },
        { from: 'command-1', to: 'reaction-1', relation: 'caused-by-event' },
      ],
    })
  })

  it('includes sequence zero in default activity and SSE reads', async () => {
    const { collector } = await setup()
    await collector.ingest(
      batch('sequence-zero', [
        observation({
          observationId: 'sequence-zero-observation',
          sequence: 0,
          kind: 'query.started',
          operationId: 'sequence-zero-query',
        }),
      ]),
    )

    await expect(collector.activity()).resolves.toMatchObject([
      { observationId: 'sequence-zero-observation', sequence: 0 },
    ])
    await expect(collector.activity({ afterSequence: 0 })).resolves.toEqual([])

    const handler = createSpecterObservabilityHttpHandler({ collector })
    const snapshot = await handler(new Request('http://collector/v1/activity'))
    await expect(snapshot.json()).resolves.toMatchObject([
      { observationId: 'sequence-zero-observation', sequence: 0 },
    ])

    const stream = await handler(new Request('http://collector/v1/stream'))
    const reader = stream.body?.getReader()
    const frame = await reader?.read()
    expect(new TextDecoder().decode(frame?.value)).toContain(
      '"observationId":"sequence-zero-observation"',
    )
    await reader?.cancel()
  })

  it('builds an exact causal closure for a long chain', async () => {
    const { collector } = await setup()
    const chainLength = 300
    const observations = Array.from({ length: chainLength }, (_, index) =>
      observation({
        observationId: `scale-observation-${index}`,
        sequence: index,
        kind: 'query.completed',
        operationId: `scale-operation-${index}`,
        parentOperationIds: index === 0 ? [] : [`scale-operation-${index - 1}`],
      }),
    )
    for (let index = 0; index < observations.length; index += 100) {
      await collector.ingest(
        batch(
          `scale-batch-${index / 100}`,
          observations.slice(index, index + 100),
        ),
      )
    }

    const trace = await collector.trace(`scale-operation-${chainLength - 1}`)
    expect(trace.observations).toHaveLength(chainLength)
    expect(trace.edges).toHaveLength(chainLength - 1)
    expect(trace.observations[0]?.operationId).toBe('scale-operation-0')
    expect(trace.observations.at(-1)?.operationId).toBe(
      `scale-operation-${chainLength - 1}`,
    )
  })

  it('disambiguates colliding observation and operation IDs by source filters', async () => {
    const { collector } = await setup()
    const otherSource: RuntimeSource = {
      ...source,
      application: 'booking-reference',
      runtimeLanguage: 'go',
      instanceId: 'booking-instance',
      eventLogId: 'booking-log',
    }
    const todoParent = observation({
      observationId: 'shared-parent-observation',
      sequence: 1,
      kind: 'command.completed',
      operationId: 'shared-parent-operation',
      events: [eventReference],
    })
    const bookingParent = observation({
      source: otherSource,
      observationId: 'shared-parent-observation',
      sequence: 1,
      kind: 'command.completed',
      operationId: 'shared-parent-operation',
      events: [{ ...eventReference, type: 'booking-created' }],
    })
    const todoChild = observation({
      observationId: 'shared-child-observation',
      sequence: 2,
      kind: 'reaction.run.completed',
      operationId: 'shared-reaction',
      parentOperationIds: ['shared-parent-operation'],
      triggeringEventIds: [eventReference.eventId],
    })
    const bookingChild = observation({
      source: otherSource,
      observationId: 'shared-child-observation',
      sequence: 2,
      kind: 'reaction.run.completed',
      operationId: 'shared-reaction',
      parentOperationIds: ['shared-parent-operation'],
      triggeringEventIds: [eventReference.eventId],
    })

    await expect(
      collector.ingest(
        batch('source-collisions', [
          todoParent,
          bookingParent,
          todoChild,
          bookingChild,
        ]),
      ),
    ).resolves.toMatchObject({ accepted: 4, duplicates: 0 })

    const overview = await collector.overview()
    expect(
      overview.sources.map((item) => item.source.runtimeLanguage).sort(),
    ).toEqual(['go', 'typescript'])

    const trace = await collector.trace('shared-reaction', {
      application: source.application,
      environment: source.environment,
      instanceId: source.instanceId,
      eventLogId: source.eventLogId,
    })
    expect(trace.observations).toHaveLength(2)
    expect(trace.observations.map((item) => item.source.application)).toEqual([
      'todo-reference',
      'todo-reference',
    ])
    expect(trace.edges).toEqual([
      {
        from: 'shared-parent-operation',
        to: 'shared-reaction',
        relation: 'parent-operation',
      },
      {
        from: 'shared-parent-operation',
        to: 'shared-reaction',
        relation: 'caused-by-event',
      },
    ])

    const handler = createSpecterObservabilityHttpHandler({ collector })
    const response = await handler(
      new Request(
        'http://collector/v1/traces/shared-reaction?application=booking-reference&environment=development&instanceId=booking-instance&eventLogId=booking-log',
      ),
    )
    const bookingTrace = (await response.json()) as {
      observations: readonly RuntimeObservation[]
    }
    expect(
      bookingTrace.observations.map((item) => item.source.application),
    ).toEqual(['booking-reference', 'booking-reference'])
  })

  it('links Event causality across process instances sharing an Event Log', async () => {
    const { collector } = await setup()
    const restartedSource: RuntimeSource = {
      ...source,
      runtimeVersion: '0.4.1',
      instanceId: 'instance-2',
    }
    await collector.ingest(
      batch('restart-causality', [
        observation({
          observationId: 'before-restart',
          sequence: 1,
          kind: 'command.completed',
          operationId: 'command-before-restart',
          events: [eventReference],
        }),
        observation({
          source: restartedSource,
          observationId: 'after-restart',
          sequence: 1,
          kind: 'reaction.run.completed',
          operationId: 'reaction-after-restart',
          triggeringEventIds: [eventReference.eventId],
        }),
      ]),
    )

    const trace = await collector.trace('reaction-after-restart', {
      application: source.application,
      environment: source.environment,
      instanceId: restartedSource.instanceId,
      eventLogId: source.eventLogId,
    })
    expect(trace.observations.map((item) => item.observationId)).toEqual([
      'before-restart',
      'after-restart',
    ])
    expect(trace.edges).toEqual([
      {
        from: 'command-before-restart',
        to: 'reaction-after-restart',
        relation: 'caused-by-event',
      },
    ])
  })

  it('reports expected command rejections separately from runtime failures', async () => {
    const { collector } = await setup()

    await collector.ingest(
      batch('rejected-command', [
        observation({
          observationId: 'rejection-1',
          sequence: 1,
          kind: 'command.rejected',
          operationId: 'command-1',
          outcome: 'rejected',
          commandType: 'removeTodo',
        }),
      ]),
    )

    await expect(collector.overview()).resolves.toMatchObject({
      observationCount: 1,
      failureCount: 0,
      rejectionCount: 1,
      sources: [{ failureCount: 0, rejectionCount: 1 }],
    })
  })

  it('resolves a unique parent operation across instances and rejects ambiguous parents', async () => {
    const { collector } = await setup()
    const secondInstance: RuntimeSource = {
      ...source,
      instanceId: 'instance-2',
    }
    const thirdInstance: RuntimeSource = {
      ...source,
      instanceId: 'instance-3',
    }
    await collector.ingest(
      batch('cross-instance-parent', [
        observation({
          observationId: 'parent-instance-1',
          sequence: 1,
          kind: 'command.completed',
          operationId: 'unique-parent',
        }),
        observation({
          source: secondInstance,
          observationId: 'unique-child-instance-2',
          sequence: 1,
          kind: 'query.completed',
          operationId: 'unique-child',
          parentOperationIds: ['unique-parent'],
        }),
        observation({
          observationId: 'ambiguous-parent-instance-1',
          sequence: 2,
          kind: 'command.completed',
          operationId: 'ambiguous-parent',
        }),
        observation({
          source: secondInstance,
          observationId: 'ambiguous-parent-instance-2',
          sequence: 2,
          kind: 'command.completed',
          operationId: 'ambiguous-parent',
        }),
        observation({
          source: thirdInstance,
          observationId: 'ambiguous-child-instance-3',
          sequence: 1,
          kind: 'query.completed',
          operationId: 'ambiguous-child',
          parentOperationIds: ['ambiguous-parent'],
        }),
      ]),
    )

    await expect(
      collector.trace('unique-child', {
        instanceId: secondInstance.instanceId,
      }),
    ).resolves.toMatchObject({
      observations: [
        { operationId: 'unique-parent' },
        { operationId: 'unique-child' },
      ],
      edges: [
        {
          from: 'unique-parent',
          to: 'unique-child',
          relation: 'parent-operation',
        },
      ],
    })
    await expect(
      collector.trace('ambiguous-child', {
        instanceId: thirdInstance.instanceId,
      }),
    ).resolves.toMatchObject({
      observations: [{ operationId: 'ambiguous-child' }],
      edges: [],
    })
  })

  it('deduplicates by observation identity rather than batch request ID', async () => {
    const { collector, eventLog } = await setup()
    const input = batch('retryable-batch', [
      observation({
        observationId: 'observation-1',
        sequence: 1,
        kind: 'command.started',
        operationId: 'command-1',
      }),
    ])

    await collector.ingest(input)
    await expect(collector.ingest(input)).resolves.toMatchObject({
      accepted: 0,
      duplicates: 1,
    })
    await expect(
      collector.ingest(batch('different-batch', input.observations)),
    ).resolves.toMatchObject({ accepted: 0, duplicates: 1 })
    await expect(
      collector.ingest(
        batch('retryable-batch', [
          observation({
            observationId: 'observation-2',
            sequence: 2,
            kind: 'command.completed',
            operationId: 'command-1',
          }),
        ]),
      ),
    ).resolves.toMatchObject({ accepted: 1, duplicates: 0 })
    expect(eventLog.inspect()).toHaveLength(2)
    await expect(collector.overview()).resolves.toMatchObject({
      observationCount: 2,
    })
  })

  it('serves validated protocol ingestion and a safe HTML dashboard', async () => {
    const { collector } = await setup()
    const handler = createSpecterObservabilityHttpHandler({ collector })
    const input = batch('http-batch', [
      observation({
        observationId: 'observation-1',
        sequence: 1,
        kind: 'query.failed',
        operationId: 'query-1',
        outcome: 'failed',
        error: { code: 'QUERY_FAILED', message: '<private>' },
      }),
    ])

    const ingestion = await handler(
      new Request('http://collector/specter/v1/observations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      }),
    )
    expect(ingestion.status).toBe(202)
    expect(ingestion.headers.get('Specter-Protocol-Version')).toBe('1')
    const overview = await handler(new Request('http://collector/v1/overview'))
    expect(overview.headers.get('Specter-Protocol-Version')).toBeNull()
    expect(overview.headers.get('cache-control')).toBe('no-store')
    await expect(overview.json()).resolves.toMatchObject({ failureCount: 1 })
    const dashboard = await handler(new Request('http://collector/'))
    expect(dashboard.headers.get('Specter-Protocol-Version')).toBeNull()
    expect(dashboard.headers.get('cache-control')).toBe('no-store')
    const html = await dashboard.text()
    expect(html).toContain('Specter runtime observability')
    expect(html).not.toContain('<private>')

    const malformed = await handler(
      new Request('http://collector/specter/v1/observations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{',
      }),
    )
    expect(malformed.status).toBe(400)
    expect(malformed.headers.get('Specter-Protocol-Version')).toBe('1')
    await expect(malformed.json()).resolves.toEqual({
      error: {
        code: 'SPECTER_INVALID_JSON',
        message: 'Malformed JSON request.',
      },
    })

    const wrongContentType = await handler(
      new Request('http://collector/specter/v1/observations', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    )
    expect(wrongContentType.status).toBe(415)
    expect(wrongContentType.headers.get('Specter-Protocol-Version')).toBe('1')
    await expect(wrongContentType.json()).resolves.toEqual({
      error: {
        code: 'SPECTER_INVALID_MESSAGE',
        message: 'Protocol message is invalid.',
      },
    })

    const wrongMethod = await handler(
      new Request('http://collector/specter/v1/observations'),
    )
    expect(wrongMethod.status).toBe(404)
    expect(wrongMethod.headers.get('Specter-Protocol-Version')).toBe('1')
    await expect(wrongMethod.json()).resolves.toEqual({
      error: {
        code: 'SPECTER_OBSERVABILITY_ROUTE_NOT_FOUND',
        message: 'Route not found.',
      },
    })

    const removedCapabilityRoute = await handler(
      new Request('http://collector/specter/v1/capabilities', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          protocolVersion: 1,
          kind: 'query.request',
          requestId: 'wrong-capability-kind',
          operationId: 'query-operation',
          query: { type: 'overview', payload: {} },
        }),
      }),
    )
    expect(removedCapabilityRoute.status).toBe(404)
    expect(
      removedCapabilityRoute.headers.get('Specter-Protocol-Version'),
    ).toBeNull()
    await expect(removedCapabilityRoute.json()).resolves.toEqual({
      error: {
        code: 'SPECTER_OBSERVABILITY_ROUTE_NOT_FOUND',
        message: 'Route not found.',
      },
    })

    await expect(collector.ingest(batch('empty-direct', []))).resolves.toEqual({
      protocolVersion: 1,
      kind: 'observations.ack',
      requestId: 'empty-direct',
      accepted: 0,
      duplicates: 0,
    })
    const empty = await handler(
      new Request('http://collector/specter/v1/observations', {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify(batch('empty-http', [])),
      }),
    )
    expect(empty.status).toBe(202)
    await expect(empty.json()).resolves.toMatchObject({
      requestId: 'empty-http',
      accepted: 0,
      duplicates: 0,
    })
  })

  it('redacts unexpected HTTP and activity-stream failures', async () => {
    const credential = 'postgres://admin:secret@collector.internal/runtime'
    const handler = createSpecterObservabilityHttpHandler({
      collector: {
        async overview() {
          throw new Error(credential)
        },
        async *subscribeActivity() {
          yield await Promise.reject(new Error(credential))
        },
      } as never,
    })

    const response = await handler(new Request('http://collector/v1/overview'))
    const body = await response.text()
    expect(response.status).toBe(500)
    expect(body).not.toContain(credential)
    expect(JSON.parse(body)).toMatchObject({
      error: {
        code: 'SPECTER_INTERNAL_ERROR',
        message: 'The Specter runtime could not complete the request.',
      },
    })

    const stream = await handler(new Request('http://collector/v1/stream'))
    const frame = await stream.body?.getReader().read()
    const text = new TextDecoder().decode(frame?.value)
    expect(text).not.toContain(credential)
    expect(text).toContain('SPECTER_INTERNAL_ERROR')
  })

  it('drops oldest queued telemetry without backpressuring the caller', async () => {
    const bodies: RuntimeObservationBatch[] = []
    const producer = createRuntimeObservationProducer({
      collectorUrl: 'http://collector',
      source,
      maxQueuedObservations: 2,
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as RuntimeObservationBatch
        bodies.push(body)
        return acknowledgement(body)
      },
      idFactory: (() => {
        let id = 0
        return () => `generated-${++id}`
      })(),
      now: () => new Date('2026-07-18T12:00:01.000Z'),
    })

    producer.record(
      observation({
        observationId: 'oldest',
        sequence: 1,
        kind: 'query.started',
        operationId: 'query-1',
      }),
    )
    producer.record(
      observation({
        observationId: 'kept-1',
        sequence: 2,
        kind: 'query.started',
        operationId: 'query-2',
      }),
    )
    producer.record(
      observation({
        observationId: 'kept-2',
        sequence: 3,
        kind: 'query.started',
        operationId: 'query-3',
      }),
    )
    await producer.flush()

    expect(producer.inspect()).toMatchObject({ queued: 0, dropped: 1 })
    expect(
      bodies.flatMap((body) => body.observations.map((item) => item.kind)),
    ).toEqual(['query.started', 'query.started', 'telemetry.dropped'])
    expect(
      bodies.flatMap((body) => body.observations.map((item) => item.sequence)),
    ).toEqual([2, 3, 4])
    expect(
      bodies[0]?.observations.some((item) => item.observationId === 'oldest'),
    ).toBe(false)
  })

  it('reports dropped telemetry after earlier sequences across batch boundaries', async () => {
    const bodies: RuntimeObservationBatch[] = []
    const producer = createRuntimeObservationProducer({
      collectorUrl: 'http://collector',
      source,
      maxQueuedObservations: 1,
      maxBatchSize: 1,
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as RuntimeObservationBatch
        bodies.push(body)
        return acknowledgement(body)
      },
      idFactory: (() => {
        let id = 0
        return () => `ordered-${++id}`
      })(),
    })
    producer.record(
      observation({
        observationId: 'dropped',
        sequence: 1,
        kind: 'query.started',
        operationId: 'query-1',
      }),
    )
    producer.record(
      observation({
        observationId: 'retained',
        sequence: 2,
        kind: 'query.started',
        operationId: 'query-2',
      }),
    )

    await producer.flush()

    expect(bodies.map((body) => body.observations[0]?.kind)).toEqual([
      'query.started',
      'telemetry.dropped',
    ])
    expect(
      bodies.flatMap((body) => body.observations.map((item) => item.sequence)),
    ).toEqual([2, 3])
  })

  it('keeps the batch request ID stable across transport retries', async () => {
    const requestIds: string[] = []
    let attempts = 0
    const producer = createRuntimeObservationProducer({
      collectorUrl: 'http://collector',
      source,
      retryDelayMs: 60_000,
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as RuntimeObservationBatch
        requestIds.push(body.requestId)
        attempts += 1
        if (attempts === 1) throw new Error('offline')
        return Response.json({
          protocolVersion: 1,
          kind: 'observations.ack',
          requestId: body.requestId,
          accepted: body.observations.length,
          duplicates: 0,
        })
      },
      idFactory: (() => {
        let id = 0
        return () => `retry-${++id}`
      })(),
    })
    producer.record(
      observation({
        observationId: 'retry-observation',
        sequence: 1,
        kind: 'command.started',
        operationId: 'retry-command',
      }),
    )

    await producer.flush()
    await producer.flush()

    expect(requestIds).toHaveLength(2)
    expect(requestIds[0]).toBe(requestIds[1])
  })

  it('expires an unacknowledged batch at the deduplication retry horizon and reports its loss', async () => {
    const bodies: RuntimeObservationBatch[] = []
    let currentTime = new Date('2026-07-18T12:00:00.000Z')
    let attempts = 0
    const producer = createRuntimeObservationProducer({
      collectorUrl: 'http://collector',
      source,
      retryWindowMs: 1_000,
      retryDelayMs: 60_000,
      now: () => currentTime,
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as RuntimeObservationBatch
        bodies.push(body)
        attempts += 1
        if (attempts === 1) throw new Error('response lost')
        return acknowledgement(body)
      },
      idFactory: (() => {
        let id = 0
        return () => `horizon-${++id}`
      })(),
    })
    producer.record(
      observation({
        observationId: 'expires-before-retry',
        sequence: 1,
        kind: 'query.started',
        operationId: 'query-1',
      }),
    )

    await producer.flush()
    currentTime = new Date('2026-07-18T12:00:01.001Z')
    await producer.flush()

    expect(bodies).toHaveLength(2)
    expect(bodies[0]?.observations).toMatchObject([
      { observationId: 'expires-before-retry' },
    ])
    expect(bodies[1]?.observations).toMatchObject([
      { kind: 'telemetry.dropped', droppedCount: 1 },
    ])
    expect(producer.inspect()).toMatchObject({ queued: 0, dropped: 1 })
  })

  it('retries an immutable batch when queue pressure changes later observations', async () => {
    const bodies: RuntimeObservationBatch[] = []
    let attempts = 0
    const producer = createRuntimeObservationProducer({
      collectorUrl: 'http://collector',
      source,
      maxQueuedObservations: 4,
      retryDelayMs: 60_000,
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as RuntimeObservationBatch
        bodies.push(body)
        attempts += 1
        if (attempts === 1) throw new Error('response lost')
        return Response.json({
          protocolVersion: 1,
          kind: 'observations.ack',
          requestId: body.requestId,
          accepted: body.observations.length,
          duplicates: 0,
        })
      },
      idFactory: (() => {
        let id = 0
        return () => `pressure-${++id}`
      })(),
      now: () => new Date('2026-07-18T12:00:01.000Z'),
    })
    for (const [id, sequence] of [
      ['original-1', 1],
      ['original-2', 2],
    ] as const) {
      producer.record(
        observation({
          observationId: id,
          sequence,
          kind: 'query.started',
          operationId: id,
        }),
      )
    }
    await producer.flush()
    for (const [id, sequence] of [
      ['later-dropped', 3],
      ['later-1', 4],
      ['later-2', 5],
    ] as const) {
      producer.record(
        observation({
          observationId: id,
          sequence,
          kind: 'query.started',
          operationId: id,
        }),
      )
    }
    await producer.flush()

    expect(bodies).toHaveLength(3)
    expect(bodies[1]).toEqual(bodies[0])
    expect(bodies[2]?.requestId).not.toBe(bodies[0]?.requestId)
    expect(bodies[2]?.observations.at(-1)).toMatchObject({
      kind: 'telemetry.dropped',
      droppedCount: 1,
    })
    expect(
      bodies[2]?.observations.slice(0, -1).map((item) => item.observationId),
    ).toEqual(['later-1', 'later-2'])
  })

  it('bounds the immutable in-flight batch and mutable queue together', async () => {
    const bodies: RuntimeObservationBatch[] = []
    const started = Promise.withResolvers<void>()
    const responseGate = Promise.withResolvers<void>()
    const producer = createRuntimeObservationProducer({
      collectorUrl: 'http://collector',
      source,
      maxQueuedObservations: 2,
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as RuntimeObservationBatch
        bodies.push(body)
        if (bodies.length === 1) {
          started.resolve()
          await responseGate.promise
        }
        return acknowledgement(body)
      },
      idFactory: (() => {
        let id = 0
        return () => `bounded-${++id}`
      })(),
    })
    producer.record(
      observation({
        observationId: 'in-flight-1',
        sequence: 1,
        kind: 'query.started',
        operationId: 'in-flight-1',
      }),
    )
    producer.record(
      observation({
        observationId: 'in-flight-2',
        sequence: 2,
        kind: 'query.started',
        operationId: 'in-flight-2',
      }),
    )
    await started.promise

    for (let sequence = 3; sequence <= 5; sequence += 1) {
      producer.record(
        observation({
          observationId: `pressure-${sequence}`,
          sequence,
          kind: 'query.started',
          operationId: `pressure-${sequence}`,
        }),
      )
      expect(producer.inspect().queued).toBeLessThanOrEqual(2)
    }
    expect(producer.inspect()).toMatchObject({ queued: 2, dropped: 3 })

    responseGate.resolve()
    await producer.flush()
    expect(bodies[0]?.observations.map((item) => item.observationId)).toEqual([
      'in-flight-1',
      'in-flight-2',
    ])
    expect(bodies[1]?.observations).toMatchObject([
      { kind: 'telemetry.dropped', droppedCount: 3 },
    ])
    expect(bodies.every((body) => body.observations.length <= 2)).toBe(true)
    expect(producer.inspect()).toMatchObject({ queued: 0, dropped: 3 })
  })

  it.each([
    ['malformed', () => Response.json({ ok: true })],
    [
      'mismatched request',
      (input: RuntimeObservationBatch) =>
        acknowledgement(input, { requestId: 'another-request' }),
    ],
    [
      'partial accounting',
      (input: RuntimeObservationBatch) =>
        acknowledgement(input, { accepted: 0 }),
    ],
    [
      'duplicate rejected IDs',
      (input: RuntimeObservationBatch) =>
        acknowledgement(input, {
          accepted: 0,
          rejectedObservationIds: [
            input.observations[0]?.observationId ?? 'missing',
            input.observations[0]?.observationId ?? 'missing',
          ],
        }),
    ],
    ['empty', () => new Response(null, { status: 202 })],
    [
      'non-success HTTP',
      (input: RuntimeObservationBatch) =>
        new Response(JSON.stringify(acknowledgementBody(input)), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        }),
    ],
  ])('retains an immutable batch after a %s acknowledgement', async (_, invalid) => {
    const bodies: RuntimeObservationBatch[] = []
    let attempt = 0
    const producer = createRuntimeObservationProducer({
      collectorUrl: 'http://collector',
      source,
      retryDelayMs: 60_000,
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as RuntimeObservationBatch
        bodies.push(body)
        attempt += 1
        return attempt === 1 ? invalid(body) : acknowledgement(body)
      },
    })
    producer.record(
      observation({
        observationId: 'kept-until-acknowledged',
        sequence: 1,
        kind: 'command.started',
        operationId: 'command-1',
      }),
    )

    await producer.flush()
    expect(producer.inspect().queued).toBe(1)
    await producer.flush()

    expect(bodies).toHaveLength(2)
    expect(bodies[1]).toEqual(bodies[0])
    expect(producer.inspect().queued).toBe(0)
  })

  it('accepts an acknowledgement that explicitly rejects the complete batch', async () => {
    const producer = createRuntimeObservationProducer({
      collectorUrl: 'http://collector',
      source,
      maxQueuedObservations: 0,
      maxBatchSize: 0,
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as RuntimeObservationBatch
        return acknowledgement(body, {
          accepted: 0,
          rejectedObservationIds: body.observations.map(
            (item) => item.observationId,
          ),
        })
      },
    })
    producer.record(
      observation({
        observationId: 'explicitly-rejected',
        sequence: 1,
        kind: 'command.started',
        operationId: 'command-1',
      }),
    )

    await producer.flush()

    expect(producer.inspect().queued).toBe(0)
  })

  it('redacts unstructured runtime failures at the protocol boundary', async () => {
    const recorded: RuntimeObservation[] = []
    const emitter = createRuntimeObservationEmitter({
      source,
      producer: { record: (item) => recorded.push(item) },
    })

    await Effect.runPromise(
      emitter.observer.observe({
        type: 'reaction-run-failed',
        observationId: 'core-observation',
        observedAt: '2026-07-18T12:00:00.000Z',
        operationId: 'reaction-operation',
        parentOperationIds: [],
        causedByEvents: [],
        reactionName: 'todoCheer',
        deliveryId: 'todoCheer:4',
        commitVersion: 4,
        durationMs: 2,
        cause: new Error('private database connection string'),
      }),
    )

    expect(recorded[0]).toMatchObject({
      kind: 'reaction.run.failed',
      error: {
        code: 'SPECTER_INTERNAL_ERROR',
        message: 'The Specter runtime could not complete the request.',
      },
    })
    expect(JSON.stringify(recorded)).not.toContain('private database')
  })

  it('preserves inbound protocol causality alongside local Event metadata', async () => {
    const recorded: RuntimeObservation[] = []
    const emitter = createRuntimeObservationEmitter({
      source,
      producer: { record: (item) => recorded.push(item) },
    })

    await Effect.runPromise(
      emitter.observer.observe({
        type: 'command-started',
        observationId: 'causal-observation',
        observedAt: '2026-07-18T12:00:00.000Z',
        operationId: 'causal-operation',
        parentOperationIds: ['parent-operation'],
        causedByEvents: [
          {
            id: 'local-event',
            type: 'local-event',
            order: 8,
            recordedAt: '2026-07-18T12:00:00.000Z',
            commitVersion: 4,
          },
        ],
        triggeringEventIds: ['remote-event'],
        triggeringEventOrder: { from: 2, to: 6 },
        commandType: 'followUp',
      }),
    )

    expect(recorded[0]).toMatchObject({
      triggeringEventIds: ['remote-event', 'local-event'],
      triggeringEventOrder: { from: 2, to: 6 },
    })
  })

  it('links a two-attempt outbox lifecycle through retry and dead letter', async () => {
    const recorded: RuntimeObservation[] = []
    const emitter = createRuntimeObservationEmitter({
      source,
      producer: { record: (item) => recorded.push(item) },
    })
    const requestedAt = new Date('2026-07-18T12:00:00.000Z')
    const availableAt = new Date('2026-07-18T12:00:01.000Z')
    const leaseExpiresAt = new Date('2026-07-18T12:01:00.000Z')
    const job = {
      id: 'email-delivery',
      idempotencyKey: 'email-delivery-key',
      payload: {},
      status: 'pending',
      requestedAt,
      availableAt,
      attemptCount: 0,
    } satisfies ReactionOutboxJob
    const firstClaim = {
      ...job,
      status: 'running',
      attemptCount: 1,
      activeAttemptId: 'email-delivery:attempt:1',
      leaseExpiresAt,
    } satisfies ReactionOutboxClaim
    const secondClaim = {
      ...firstClaim,
      attemptCount: 2,
      activeAttemptId: 'email-delivery:attempt:2',
    } satisfies ReactionOutboxClaim

    await emitter.outbox({ type: 'enqueued', job, created: true })
    await emitter.outbox({ type: 'attempt-started', claim: firstClaim })
    await emitter.outbox({
      type: 'attempt-retrying',
      claim: firstClaim,
      availableAt,
      error: 'temporary failure',
    })
    await emitter.outbox({ type: 'attempt-started', claim: secondClaim })
    await emitter.outbox({
      type: 'dead-lettered',
      claim: secondClaim,
      failedAt: availableAt,
      error: 'permanent failure',
    })

    expect(recorded.map((item) => item.deliveryId)).toEqual(
      Array(5).fill('email-delivery'),
    )
    expect(recorded.map((item) => item.attributes?.attemptNumber)).toEqual([
      undefined,
      1,
      1,
      2,
      2,
    ])
    for (let index = 1; index < recorded.length; index += 1) {
      expect(recorded[index]?.parentOperationIds).toEqual([
        recorded[index - 1]?.operationId,
      ])
    }

    const { collector } = await setup()
    await collector.ingest(batch('outbox-lifecycle', recorded))
    const lastOperationId = recorded.at(-1)?.operationId
    expect(lastOperationId).toBeDefined()
    const trace = await collector.trace(lastOperationId as string, {
      application: source.application,
      environment: source.environment,
      instanceId: source.instanceId,
      eventLogId: source.eventLogId,
    })
    expect(trace.observations.map((item) => item.kind)).toEqual([
      'outbox.enqueued',
      'outbox.attempted',
      'outbox.retry-scheduled',
      'outbox.attempted',
      'outbox.dead-lettered',
    ])
    expect(
      trace.edges.filter((edge) => edge.relation === 'parent-operation'),
    ).toHaveLength(4)
  })

  it('reconstructs a Reaction to dead-letter trace across process restarts', async () => {
    const { collector } = await setup()
    const restartedSource = (instanceId: string): RuntimeSource => ({
      ...source,
      instanceId,
    })
    const lifecycle = [
      observation({
        source: restartedSource('outbox-enqueue'),
        observationId: 'outbox-enqueued',
        sequence: 1,
        kind: 'outbox.enqueued',
        operationId: 'enqueue-operation',
        deliveryId: 'reaction-delivery',
      }),
      observation({
        source: restartedSource('outbox-attempt-1'),
        observationId: 'outbox-attempt-1',
        sequence: 1,
        kind: 'outbox.attempted',
        operationId: 'attempt-1-operation',
        deliveryId: 'reaction-delivery',
      }),
      observation({
        source: restartedSource('reaction-worker'),
        observationId: 'reaction-run-failed',
        sequence: 2,
        kind: 'reaction.run.failed',
        operationId: 'reaction-run-operation',
        deliveryId: 'reaction-delivery',
      }),
      observation({
        source: restartedSource('outbox-retry'),
        observationId: 'outbox-retry',
        sequence: 1,
        kind: 'outbox.retry-scheduled',
        operationId: 'retry-operation',
        deliveryId: 'reaction-delivery',
      }),
      observation({
        source: restartedSource('outbox-attempt-2'),
        observationId: 'outbox-attempt-2',
        sequence: 1,
        kind: 'outbox.attempted',
        operationId: 'attempt-2-operation',
        deliveryId: 'reaction-delivery',
      }),
      observation({
        source: restartedSource('outbox-dead-letter'),
        observationId: 'outbox-dead-letter',
        sequence: 1,
        kind: 'outbox.dead-lettered',
        operationId: 'dead-letter-operation',
        deliveryId: 'reaction-delivery',
      }),
    ]
    await collector.ingest(batch('restart-outbox-lifecycle', lifecycle))

    const trace = await collector.trace('dead-letter-operation', {
      instanceId: 'outbox-dead-letter',
    })
    expect(trace.observations.map((item) => item.operationId)).toEqual(
      lifecycle.map((item) => item.operationId),
    )
    expect(trace.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: 'attempt-2-operation',
          to: 'dead-letter-operation',
          relation: 'delivery',
        }),
      ]),
    )
  })

  it('redacts coded failures and preserves stable Reaction delivery identity', async () => {
    const recorded: RuntimeObservation[] = []
    const emitter = createRuntimeObservationEmitter({
      source,
      producer: { record: (item) => recorded.push(item) },
    })
    const credential = new Error('password=hunter2') as Error & {
      code: string
    }
    credential.code = 'SPECTER_INFRASTRUCTURE_FAILURE'

    for (const phase of ['started', 'failed'] as const) {
      await Effect.runPromise(
        emitter.observer.observe({
          type: `reaction-run-${phase}`,
          observationId: `run-${phase}`,
          observedAt: '2026-07-18T12:00:00.000Z',
          operationId: `run-operation-${phase}`,
          parentOperationIds: [],
          causedByEvents: [],
          reactionName: 'sendEmail',
          deliveryId: 'sendEmail:4',
          commitVersion: 4,
          ...(phase === 'failed' ? { durationMs: 2, cause: credential } : {}),
        }),
      )
    }

    expect(recorded.map((item) => item.deliveryId)).toEqual([
      'sendEmail:4',
      'sendEmail:4',
    ])
    expect(recorded.some((item) => 'reactionPassId' in item)).toBe(false)
    expect(recorded.some((item) => 'attemptId' in item)).toBe(false)
    expect(JSON.stringify(recorded)).not.toContain('hunter2')
  })
})

function acknowledgementBody(input: RuntimeObservationBatch) {
  return {
    protocolVersion: 1,
    kind: 'observations.ack',
    requestId: input.requestId,
    accepted: input.observations.length,
    duplicates: 0,
  }
}

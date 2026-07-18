import { describe, expect, it } from 'vitest'
import type {
  RuntimeObservation,
  RuntimeObservationAcknowledgement,
  RuntimeObservationBatch,
  RuntimeSource,
} from '@specter-ts/protocol'
import {
  createMemoryEventLog,
  createMemorySliceStore,
} from '@specter-ts/memory'

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
  const store = createMemorySliceStore(createCollectorState, {
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

  it('scopes causal event and operation identities to their runtime source', async () => {
    const { collector } = await setup()
    const otherSource: RuntimeSource = {
      ...source,
      application: 'booking-reference',
      instanceId: 'booking-instance',
      eventLogId: 'booking-log',
    }
    const todoParent = observation({
      observationId: 'todo-parent',
      sequence: 1,
      kind: 'command.completed',
      operationId: 'shared-parent-operation',
      events: [eventReference],
    })
    const bookingParent = observation({
      source: otherSource,
      observationId: 'booking-parent',
      sequence: 1,
      kind: 'command.completed',
      operationId: 'foreign-operation',
      events: [{ ...eventReference, type: 'booking-created' }],
    })
    const todoChild = observation({
      observationId: 'todo-child',
      sequence: 2,
      kind: 'reaction.run.completed',
      operationId: 'todo-reaction',
      parentOperationIds: ['shared-parent-operation'],
      triggeringEventIds: [eventReference.eventId],
    })
    const bookingChildWithCollidingParentId = observation({
      source: otherSource,
      observationId: 'booking-child',
      sequence: 2,
      kind: 'reaction.run.completed',
      operationId: 'foreign-reaction',
      parentOperationIds: ['shared-parent-operation'],
    })

    await collector.ingest(
      batch('source-collisions', [
        todoParent,
        bookingParent,
        todoChild,
        bookingChildWithCollidingParentId,
      ]),
    )

    const trace = await collector.trace('todo-reaction')
    expect(trace.observations.map((item) => item.observationId)).toEqual([
      'todo-parent',
      'todo-child',
    ])
    expect(trace.edges).toEqual([
      {
        from: 'shared-parent-operation',
        to: 'todo-reaction',
        relation: 'parent-operation',
      },
      {
        from: 'shared-parent-operation',
        to: 'todo-reaction',
        relation: 'caused-by-event',
      },
    ])
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
    const overview = await handler(new Request('http://collector/v1/overview'))
    await expect(overview.json()).resolves.toMatchObject({ failureCount: 1 })
    const html = await (await handler(new Request('http://collector/'))).text()
    expect(html).toContain('Specter runtime observability')
    expect(html).not.toContain('<private>')
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
      endpoint: 'http://collector',
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
    expect(bodies[0]?.observations.map((item) => item.kind)).toEqual([
      'query.started',
      'query.started',
      'telemetry.dropped',
    ])
    expect(bodies[0]?.observations.map((item) => item.sequence)).toEqual([
      2, 3, 4,
    ])
    expect(
      bodies[0]?.observations.some((item) => item.observationId === 'oldest'),
    ).toBe(false)
  })

  it('reports dropped telemetry after earlier sequences across batch boundaries', async () => {
    const bodies: RuntimeObservationBatch[] = []
    const producer = createRuntimeObservationProducer({
      endpoint: 'http://collector',
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
      endpoint: 'http://collector',
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

  it('retries an immutable batch when queue pressure changes later observations', async () => {
    const bodies: RuntimeObservationBatch[] = []
    let attempts = 0
    const producer = createRuntimeObservationProducer({
      endpoint: 'http://collector',
      source,
      maxQueuedObservations: 2,
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
      endpoint: 'http://collector',
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
      endpoint: 'http://collector',
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

  it('redacts unstructured runtime failures at the protocol boundary', () => {
    const recorded: RuntimeObservation[] = []
    const emitter = createRuntimeObservationEmitter({
      source,
      producer: { record: (item) => recorded.push(item) },
    })

    emitter.observe({
      type: 'reaction-run-failed',
      observationId: 'core-observation',
      observedAt: '2026-07-18T12:00:00.000Z',
      operationId: 'reaction-operation',
      parentOperationIds: [],
      causedByEvents: [],
      reactionName: 'todoCheer',
      runId: 'run-1',
      passId: 'pass-1',
      attemptId: 'attempt-1',
      durationMs: 2,
      cause: new Error('private database connection string'),
    })

    expect(recorded[0]).toMatchObject({
      kind: 'reaction.run.failed',
      error: {
        code: 'SPECTER_INTERNAL_ERROR',
        message: 'The Specter runtime could not complete the request.',
      },
    })
    expect(JSON.stringify(recorded)).not.toContain('private database')
  })

  it('redacts coded failures and preserves retry-stable Reaction identities', () => {
    const recorded: RuntimeObservation[] = []
    const emitter = createRuntimeObservationEmitter({
      source,
      producer: { record: (item) => recorded.push(item) },
    })
    const credential = new Error('password=hunter2') as Error & {
      code: string
    }
    credential.code = 'SPECTER_INFRASTRUCTURE_FAILURE'

    for (const [attemptId, attemptNumber] of [
      ['pass-attempt-1', 1],
      ['pass-attempt-2', 2],
    ] as const) {
      emitter.observe({
        type: 'reaction-pass-started',
        observationId: `reaction-pass-started-${attemptNumber}`,
        observedAt: '2026-07-18T12:00:00.000Z',
        operationId: `pass-operation-${attemptNumber}`,
        parentOperationIds: [],
        causedByEvents: [],
        passId: 'stable-pass',
        attemptId,
        attemptNumber,
      })
      emitter.observe({
        type: 'reaction-pass-failed',
        observationId: `reaction-pass-failed-${attemptNumber}`,
        observedAt: '2026-07-18T12:00:00.000Z',
        operationId: `pass-operation-${attemptNumber}`,
        parentOperationIds: [],
        causedByEvents: [],
        passId: 'stable-pass',
        attemptId,
        attemptNumber,
        eventRanges: [],
        failureCount: 1,
        durationMs: 2,
        cause: credential,
      })
      emitter.observe({
        type: 'reaction-run-failed',
        observationId: `run-${attemptNumber}`,
        observedAt: '2026-07-18T12:00:00.000Z',
        operationId: `run-operation-${attemptNumber}`,
        parentOperationIds: [],
        causedByEvents: [],
        reactionName: 'sendEmail',
        runId: `run-attempt-${attemptNumber}`,
        passId: 'stable-pass',
        attemptId,
        eventRange: { fromOrder: 2, toOrder: 4, eventCount: 3 },
        durationMs: 2,
        cause: credential,
      })
    }

    const passes = recorded.filter((item) =>
      item.kind.startsWith('reaction.pass.'),
    )
    const runs = recorded.filter((item) => item.reaction === 'sendEmail')
    expect(passes.map((item) => item.deliveryId)).toEqual(
      Array(passes.length).fill('stable-pass'),
    )
    expect(new Set(passes.map((item) => item.attemptId))).toEqual(
      new Set(['pass-attempt-1', 'pass-attempt-2']),
    )
    expect(runs.map((item) => item.deliveryId)).toEqual([
      'stable-pass:sendEmail:4',
      'stable-pass:sendEmail:4',
    ])
    expect(runs.map((item) => item.attemptId)).toEqual([
      'pass-attempt-1:sendEmail:4',
      'pass-attempt-2:sendEmail:4',
    ])
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

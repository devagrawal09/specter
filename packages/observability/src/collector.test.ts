import { describe, expect, it } from 'vitest'
import type {
  RuntimeObservation,
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

  it('uses batch request IDs for collector-side retry deduplication', async () => {
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
    expect(eventLog.inspect()).toHaveLength(1)
    await expect(collector.overview()).resolves.toMatchObject({
      observationCount: 1,
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

  it('drops oldest queued telemetry without backpressuring the caller', async () => {
    const bodies: RuntimeObservationBatch[] = []
    const producer = createRuntimeObservationProducer({
      endpoint: 'http://collector',
      source,
      maxQueuedObservations: 2,
      fetch: async (_input, init) => {
        bodies.push(JSON.parse(String(init?.body)) as RuntimeObservationBatch)
        return Response.json({ ok: true })
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
      'telemetry.dropped',
      'query.started',
      'query.started',
    ])
    expect(
      bodies[0]?.observations.some((item) => item.observationId === 'oldest'),
    ).toBe(false)
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
        code: 'SPECTER_RUNTIME_FAILURE',
        message: 'Runtime operation failed.',
      },
    })
    expect(JSON.stringify(recorded)).not.toContain('private database')
  })
})

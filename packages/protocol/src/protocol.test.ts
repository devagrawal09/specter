import { describe, expect, it, vi } from 'vitest'

import { negotiateCapabilities } from './capabilities'
import { SpecterProtocolError } from './errors'
import { createSpecterProtocolHttpHandler } from './http-server'
import {
  assertRuntimeObservationBatch,
  parseProtocolMessage,
} from './validation'
import type { ProtocolRuntimeAdapter, RuntimeObservationBatch } from './index'

const source = {
  application: 'todo',
  environment: 'test',
  runtimeLanguage: 'typescript',
  runtimeVersion: '0.3.0',
  instanceId: 'instance-1',
  eventLogId: 'log-1',
}

describe('protocol validation', () => {
  it('accepts unknown optional fields', () => {
    expect(
      parseProtocolMessage({
        protocolVersion: 1,
        kind: 'query.request',
        requestId: 'request-1',
        operationId: 'operation-1',
        query: { type: 'todosQuery', payload: {} },
        futureField: true,
      }).kind,
    ).toBe('query.request')
  })

  it('rejects another major and malformed messages with public codes', () => {
    expect(() =>
      parseProtocolMessage({
        protocolVersion: 2,
        kind: 'capabilities.request',
        requestId: 'request-1',
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'SPECTER_PROTOCOL_VERSION_MISMATCH' }),
    )
    expect(() =>
      parseProtocolMessage({
        protocolVersion: 1,
        kind: 'command.request',
        requestId: 'request-1',
        operationId: 'operation-1',
      }),
    ).toThrowError(expect.objectContaining({ code: 'SPECTER_INVALID_MESSAGE' }))
  })

  it('validates metadata-only observation batches and the 100 item bound', () => {
    const observation = {
      observationId: 'observation-1',
      sequence: 1,
      observedAt: '2026-07-18T12:00:00.000Z',
      source,
      kind: 'command.started',
      operationId: 'operation-1',
    }
    const batch = {
      protocolVersion: 1,
      kind: 'observations.batch',
      requestId: 'request-1',
      observations: [observation],
    }
    expect(() => assertRuntimeObservationBatch(batch)).not.toThrow()
    expect(() =>
      assertRuntimeObservationBatch({
        ...batch,
        observations: Array.from({ length: 101 }, (_, index) => ({
          ...observation,
          observationId: `observation-${index}`,
        })),
      }),
    ).toThrow()
  })
})

describe('capabilities', () => {
  it('negotiates supported optional names and rejects missing required names', () => {
    expect(
      negotiateCapabilities(
        { required: ['commands'], optional: ['queries', 'future'] },
        ['commands', 'queries'],
      ),
    ).toEqual(['commands', 'queries'])
    expect(() =>
      negotiateCapabilities({ required: ['future'] }, ['commands']),
    ).toThrowError(SpecterProtocolError)
  })
})

describe('reference HTTP binding', () => {
  it('dispatches commands and propagates subscription cancellation', async () => {
    let subscriptionCancelled = false
    const runtime: ProtocolRuntimeAdapter = {
      runtime: { language: 'typescript', version: 'test' },
      capabilities: [
        'commands',
        'queries',
        'query-subscriptions',
        'reaction-tickets',
        'runtime-observations',
      ],
      async command(request) {
        return {
          operationId: request.operationId,
          status: 'committed',
          version: 1,
          events: [],
        }
      },
      async query() {
        return []
      },
      async *subscribe(_request, options) {
        try {
          yield { sequence: 1, result: [] }
        } finally {
          subscriptionCancelled = options.signal.aborted
        }
      },
      async reactionTicket() {
        return { status: 'completed' }
      },
      async ingestObservations(batch: RuntimeObservationBatch) {
        return { accepted: batch.observations.length, duplicates: 0 }
      },
    }
    const handler = createSpecterProtocolHttpHandler({ runtime })
    const command = await handler(
      new Request('http://localhost/specter/v1/commands', {
        method: 'POST',
        body: JSON.stringify({
          protocolVersion: 1,
          kind: 'command.request',
          requestId: 'request-1',
          operationId: 'operation-1',
          command: { type: 'addTodo', payload: {} },
        }),
      }),
    )
    expect(command.status).toBe(200)
    expect(await command.json()).toMatchObject({
      kind: 'command.response',
      status: 'committed',
    })

    const subscription = await handler(
      new Request('http://localhost/specter/v1/subscriptions', {
        method: 'POST',
        body: JSON.stringify({
          protocolVersion: 1,
          kind: 'subscription.request',
          requestId: 'request-2',
          operationId: 'operation-2',
          query: { type: 'todosQuery', payload: {} },
        }),
      }),
    )
    const reader = subscription.body?.getReader()
    await reader?.read()
    await reader?.cancel()
    expect(subscriptionCancelled).toBe(true)
  })

  it('rejects unsupported required capabilities', async () => {
    const runtime = {
      runtime: { language: 'test', version: '1' },
      capabilities: ['queries'],
      command: vi.fn(),
      query: vi.fn(),
      subscribe: vi.fn(),
      reactionTicket: vi.fn(),
      ingestObservations: vi.fn(),
    } as unknown as ProtocolRuntimeAdapter
    const response = await createSpecterProtocolHttpHandler({ runtime })(
      new Request('http://localhost/specter/v1/capabilities', {
        method: 'POST',
        body: JSON.stringify({
          protocolVersion: 1,
          kind: 'capabilities.request',
          requestId: 'request-1',
          required: ['commands'],
        }),
      }),
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: { code: 'SPECTER_UNSUPPORTED_CAPABILITY' },
    })
  })
})

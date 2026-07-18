import { describe, expect, it, vi } from 'vitest'

import { negotiateCapabilities } from './capabilities'
import { SpecterProtocolError, structuredProtocolError } from './errors'
import { createSpecterProtocolHttpClient } from './http-client'
import { createSpecterProtocolHttpHandler } from './http-server'
import { createSpecterRuntimeProtocolAdapter } from './specter-runtime'
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
  it('does not treat inherited object keys as public runtime error codes', () => {
    const cause = new Error('private credential') as Error & { code: string }
    cause.code = 'toString'

    expect(structuredProtocolError(cause)).toEqual({
      code: 'SPECTER_INTERNAL_ERROR',
      message: 'The Specter runtime could not complete the request.',
    })
  })

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
      attemptId: 'attempt-1',
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
        observations: [{ ...observation, attemptId: '' }],
      }),
    ).toThrowError(expect.objectContaining({ code: 'SPECTER_INVALID_MESSAGE' }))
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

  it('rejects contradictory response states', () => {
    const envelope = { protocolVersion: 1, requestId: 'response-1' }
    const error = { code: 'SPECTER_INTERNAL_ERROR', message: 'Failed.' }

    for (const message of [
      {
        ...envelope,
        kind: 'command.response',
        operationId: 'command-1',
        status: 'committed',
        version: 1,
        events: [],
        error,
      },
      {
        ...envelope,
        kind: 'query.response',
        operationId: 'query-1',
        result: null,
        error,
      },
      {
        ...envelope,
        kind: 'reaction-ticket.response',
        reactionTicketId: 'ticket-1',
        status: 'completed',
        error,
      },
    ]) {
      expect(() => parseProtocolMessage(message)).toThrowError(
        expect.objectContaining({ code: 'SPECTER_INVALID_MESSAGE' }),
      )
    }
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
  it('treats subscription errors as terminal even if a server sends later frames', async () => {
    const encoder = new TextEncoder()
    const frames = [
      {
        protocolVersion: 1,
        kind: 'subscription.error',
        requestId: 'request-1',
        operationId: 'operation-1',
        error: { code: 'SPECTER_INTERNAL_ERROR', message: 'Failed.' },
      },
      {
        protocolVersion: 1,
        kind: 'subscription.value',
        requestId: 'request-1',
        operationId: 'operation-1',
        sequence: 1,
        result: [],
      },
    ]
    const client = createSpecterProtocolHttpClient('http://runtime', {
      requestId: () => 'request-1',
      fetch: async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              for (const frame of frames) {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify(frame)}\n\n`),
                )
              }
              controller.close()
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        ),
    })

    const received = []
    for await (const frame of client.subscribe({
      operationId: 'operation-1',
      query: { type: 'todosQuery', payload: {} },
    }))
      received.push(frame)

    expect(received.map((frame) => frame.kind)).toEqual(['subscription.error'])
  })

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

  it('redacts arbitrary Query and subscription failures and closes error streams', async () => {
    const privateMessage = 'postgres://admin:secret@database.internal/app'
    const runtime = {
      runtime: { language: 'test', version: '1' },
      capabilities: ['queries', 'query-subscriptions'],
      command: vi.fn(),
      async query() {
        throw new Error(privateMessage)
      },
      async *subscribe() {
        yield { sequence: 1, result: [] }
        throw new Error(privateMessage)
      },
      reactionTicket: vi.fn(),
      ingestObservations: vi.fn(),
    } as unknown as ProtocolRuntimeAdapter
    const handler = createSpecterProtocolHttpHandler({ runtime })
    const query = await handler(
      new Request('http://localhost/specter/v1/queries', {
        method: 'POST',
        body: JSON.stringify({
          protocolVersion: 1,
          kind: 'query.request',
          requestId: 'request-private-query',
          operationId: 'operation-private-query',
          query: { type: 'privateQuery', payload: {} },
        }),
      }),
    )
    const queryBody = await query.text()
    expect(queryBody).not.toContain(privateMessage)
    expect(JSON.parse(queryBody)).toMatchObject({
      error: {
        code: 'SPECTER_INTERNAL_ERROR',
        message: 'The Specter runtime could not complete the request.',
      },
    })

    const subscription = await handler(
      new Request('http://localhost/specter/v1/subscriptions', {
        method: 'POST',
        body: JSON.stringify({
          protocolVersion: 1,
          kind: 'subscription.request',
          requestId: 'request-private-subscription',
          operationId: 'operation-private-subscription',
          query: { type: 'privateQuery', payload: {} },
        }),
      }),
    )
    const reader = subscription.body?.getReader()
    await reader?.read()
    const errorFrame = await reader?.read()
    const complete = await reader?.read()
    const frame = new TextDecoder().decode(errorFrame?.value)
    expect(frame).toContain('subscription.error')
    expect(frame).not.toContain(privateMessage)
    expect(complete?.done).toBe(true)
  })

  it('keeps Reaction ticket identity stable for idempotent Command retries', async () => {
    let duplicate = false
    const app = {
      async command() {
        const result = {
          operationId: duplicate ? 'operation-2' : 'operation-1',
          events: [],
          version: 1,
          duplicate,
          reactions: Promise.resolve(),
        }
        duplicate = true
        return result
      },
    }
    const adapter = createSpecterRuntimeProtocolAdapter({
      app: app as never,
      eventLog: { currentVersion: async () => 1 } as never,
      runtimeVersion: 'test',
    })
    const base = {
      protocolVersion: 1 as const,
      kind: 'command.request' as const,
      requestId: 'request-1',
      operationId: 'operation-1',
      idempotencyKey: 'stable-command',
      command: { type: 'addTodo', payload: {} },
    }
    const committed = await adapter.command(base)
    const retried = await adapter.command({
      ...base,
      requestId: 'request-2',
      operationId: 'operation-2',
    })

    expect(committed.reactionTicketId).toBeTruthy()
    expect(retried.status).toBe('duplicate')
    expect(retried.reactionTicketId).toBe(committed.reactionTicketId)
  })

  it('handles rejected Reaction promises immediately and unreferences the expiry timer', async () => {
    const timerSpy = vi.spyOn(globalThis, 'setTimeout')
    const app = {
      async command() {
        return {
          operationId: 'operation-1',
          events: [],
          version: 1,
          duplicate: false,
          reactions: Promise.reject(
            new Error('postgres://admin:secret@database/reactions'),
          ),
        }
      },
    }
    const adapter = createSpecterRuntimeProtocolAdapter({
      app: app as never,
      eventLog: { currentVersion: async () => 1 } as never,
      runtimeVersion: 'test',
      ticketRetentionMs: 60_000,
    })
    const command = await adapter.command({
      protocolVersion: 1,
      kind: 'command.request',
      requestId: 'request-1',
      operationId: 'operation-1',
      command: { type: 'addTodo', payload: {} },
    })

    await expect(
      adapter.reactionTicket(command.reactionTicketId as string),
    ).resolves.toEqual({
      status: 'failed',
      error: {
        code: 'SPECTER_INTERNAL_ERROR',
        message: 'The Specter runtime could not complete the request.',
      },
    })
    const expiry = timerSpy.mock.results.at(-1)?.value as
      | ReturnType<typeof setTimeout>
      | undefined
    expect(expiry).toBeDefined()
    if (expiry && typeof expiry === 'object' && 'hasRef' in expiry)
      expect(expiry.hasRef()).toBe(false)
    if (expiry) clearTimeout(expiry)
    timerSpy.mockRestore()
  })

  it('expires Reaction tickets after the configured retention window', async () => {
    vi.useFakeTimers()
    try {
      const adapter = createSpecterRuntimeProtocolAdapter({
        app: {
          async command() {
            return {
              operationId: 'operation-1',
              events: [],
              version: 1,
              duplicate: false,
              reactions: Promise.resolve(),
            }
          },
        } as never,
        eventLog: { currentVersion: async () => 1 } as never,
        runtimeVersion: 'test',
        ticketRetentionMs: 25,
      })
      const command = await adapter.command({
        protocolVersion: 1,
        kind: 'command.request',
        requestId: 'request-expiring',
        operationId: 'operation-expiring',
        command: { type: 'addTodo', payload: {} },
      })
      const ticketId = command.reactionTicketId as string
      await expect(adapter.reactionTicket(ticketId)).resolves.toEqual({
        status: 'completed',
      })

      await vi.advanceTimersByTimeAsync(25)

      await expect(adapter.reactionTicket(ticketId)).resolves.toMatchObject({
        status: 'failed',
        error: { code: 'SPECTER_REACTION_TICKET_NOT_FOUND' },
      })
    } finally {
      vi.useRealTimers()
    }
  })
})

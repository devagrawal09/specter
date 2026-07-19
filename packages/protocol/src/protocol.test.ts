import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  createSpecterApp,
  createEventDefinition,
  type EventLogAdapter,
  type SpecterObservation,
} from '@specter-ts/core'
import { createCommandSlice, event } from '@specter-ts/core/spec'

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

const fixtureRoot = new URL('../../../protocol/fixtures/', import.meta.url)

describe('protocol validation', () => {
  it('does not treat inherited object keys as public runtime error codes', () => {
    const cause = new Error('private credential') as Error & { code: string }
    cause.code = 'toString'

    expect(structuredProtocolError(cause)).toEqual({
      code: 'SPECTER_INTERNAL_ERROR',
      message: 'The Specter runtime could not complete the request.',
    })
  })

  it('redacts credential-bearing protocol errors with known and unknown codes', () => {
    const credential = 'postgres://admin:secret@database.internal/specter'
    const known = structuredProtocolError(
      new SpecterProtocolError({
        code: 'SPECTER_INVALID_MESSAGE',
        message: credential,
      }),
    )
    const unknown = structuredProtocolError(
      new SpecterProtocolError({
        code: 'DATABASE_CONNECTION_FAILED',
        message: credential,
      }),
    )

    expect(known).toEqual({
      code: 'SPECTER_INVALID_MESSAGE',
      message: 'Protocol message is invalid.',
    })
    expect(unknown).toEqual({
      code: 'SPECTER_INTERNAL_ERROR',
      message: 'The Specter runtime could not complete the request.',
    })
    expect(JSON.stringify({ known, unknown })).not.toContain(credential)
  })

  it('conforms to every shared language-neutral fixture', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('manifest.json', fixtureRoot), 'utf8'),
    ) as {
      readonly cases: readonly {
        readonly name: string
        readonly file: string
        readonly valid: boolean
        readonly errorCode?: string
      }[]
    }

    for (const fixture of manifest.cases) {
      const message = JSON.parse(
        readFileSync(new URL(fixture.file, fixtureRoot), 'utf8'),
      )
      if (fixture.valid) {
        expect(() => parseProtocolMessage(message), fixture.name).not.toThrow()
      } else {
        try {
          parseProtocolMessage(message)
          throw new Error(`${fixture.name} unexpectedly passed validation`)
        } catch (cause) {
          expect(cause, fixture.name).toMatchObject({
            code: fixture.errorCode,
          })
        }
      }
    }
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
        reactionTicketId: 'ticket-1',
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
  it('redacts protocol errors from Command and Query runtime adapter paths', async () => {
    const credential = 'postgres://admin:secret@database.internal/specter'
    const app = {
      async command() {
        throw new SpecterProtocolError({
          code: 'SPECTER_INVALID_MESSAGE',
          message: credential,
        })
      },
      async query() {
        throw new SpecterProtocolError({
          code: 'DATABASE_CONNECTION_FAILED',
          message: credential,
        })
      },
    }
    const adapter = createSpecterRuntimeProtocolAdapter({
      app: app as never,
      eventLog: { currentVersion: async () => 0 } as never,
      runtimeVersion: 'test',
    })
    const command = await adapter.command({
      protocolVersion: 1,
      kind: 'command.request',
      requestId: 'command-request',
      operationId: 'command-operation',
      command: { type: 'addTodo', payload: {} },
    })
    expect(JSON.stringify(command)).not.toContain(credential)
    expect(command).toMatchObject({
      status: 'rejected',
      error: {
        code: 'SPECTER_INVALID_MESSAGE',
        message: 'Protocol message is invalid.',
      },
    })

    await expect(
      adapter.query({
        protocolVersion: 1,
        kind: 'query.request',
        requestId: 'direct-query-request',
        operationId: 'direct-query-operation',
        query: { type: 'todosQuery', payload: {} },
      }),
    ).rejects.toMatchObject({
      code: 'SPECTER_INTERNAL_ERROR',
      message: 'The Specter runtime could not complete the request.',
    })

    const response = await createSpecterProtocolHttpHandler({
      runtime: adapter,
    })(
      new Request('http://runtime/specter/v1/queries', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          protocolVersion: 1,
          kind: 'query.request',
          requestId: 'query-request',
          operationId: 'query-operation',
          query: { type: 'todosQuery', payload: {} },
        }),
      }),
    )
    const body = await response.text()
    expect(body).not.toContain(credential)
    expect(JSON.parse(body)).toMatchObject({
      kind: 'query.response',
      error: {
        code: 'SPECTER_INTERNAL_ERROR',
        message: 'The Specter runtime could not complete the request.',
      },
    })
  })

  it('rejects uncorrelated JSON responses for every request family', async () => {
    const clientFor = (response: unknown, status = 200) =>
      createSpecterProtocolHttpClient('http://runtime', {
        requestId: () => 'request-1',
        fetch: async () => Response.json(response, { status }),
      })
    const envelope = { protocolVersion: 1, requestId: 'request-1' }

    await expect(
      clientFor({
        ...envelope,
        kind: 'capabilities.response',
        requestId: 'wrong-request',
        runtime: { language: 'typescript', version: 'test' },
        supported: [],
        negotiated: [],
      }).capabilities(),
    ).rejects.toMatchObject({ code: 'SPECTER_TRANSPORT_FAILURE' })
    await expect(
      clientFor({
        ...envelope,
        kind: 'query.response',
        operationId: 'operation-1',
        result: null,
      }).command({
        operationId: 'operation-1',
        command: { type: 'addTodo', payload: {} },
      }),
    ).rejects.toThrow('mismatched message kind')
    await expect(
      clientFor({
        ...envelope,
        kind: 'command.response',
        operationId: 'wrong-operation',
        status: 'committed',
        version: 1,
        events: [],
        reactionTicketId: 'ticket-1',
      }).command({
        operationId: 'operation-1',
        command: { type: 'addTodo', payload: {} },
      }),
    ).rejects.toThrow('mismatched operation ID')
    await expect(
      clientFor({
        ...envelope,
        kind: 'query.response',
        requestId: 'wrong-request',
        operationId: 'operation-1',
        result: null,
      }).query({
        operationId: 'operation-1',
        query: { type: 'todosQuery', payload: {} },
      }),
    ).rejects.toThrow('mismatched request ID')
    await expect(
      clientFor(
        {
          ...envelope,
          kind: 'command.response',
          requestId: 'wrong-request',
          operationId: 'operation-1',
          status: 'rejected',
          version: 0,
          events: [],
          error: {
            code: 'SPECTER_COMMAND_REJECTED',
            message: 'Command was rejected.',
          },
        },
        409,
      ).command({
        operationId: 'operation-1',
        command: { type: 'addTodo', payload: {} },
      }),
    ).rejects.toThrow('mismatched request ID')
    await expect(
      clientFor({
        ...envelope,
        kind: 'reaction-ticket.response',
        reactionTicketId: 'wrong-ticket',
        status: 'completed',
      }).reactionTicket('ticket-1'),
    ).rejects.toThrow('mismatched Reaction ticket ID')
    await expect(
      clientFor({
        ...envelope,
        kind: 'observations.ack',
        requestId: 'wrong-request',
        accepted: 0,
        duplicates: 0,
      }).observations({ observations: [] }),
    ).rejects.toThrow('mismatched request ID')
    await expect(
      clientFor({
        ...envelope,
        protocolVersion: 2,
        kind: 'capabilities.response',
        runtime: { language: 'typescript', version: 'test' },
        supported: [],
        negotiated: [],
      }).capabilities(),
    ).rejects.toMatchObject({
      code: 'SPECTER_PROTOCOL_VERSION_MISMATCH',
    })
  })

  it.each([
    ['request ID', { requestId: 'wrong-request' }],
    ['operation ID', { operationId: 'wrong-operation' }],
  ])('rejects subscription frames with a mismatched %s', async (_, mismatch) => {
    const frame = {
      protocolVersion: 1,
      kind: 'subscription.value',
      requestId: 'request-1',
      operationId: 'operation-1',
      sequence: 1,
      result: [],
      ...mismatch,
    }
    const client = createSpecterProtocolHttpClient('http://runtime', {
      requestId: () => 'request-1',
      fetch: async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode(`data: ${JSON.stringify(frame)}\n\n`),
              )
              controller.close()
            },
          }),
        ),
    })

    await expect(
      (async () => {
        for await (const _frame of client.subscribe({
          operationId: 'operation-1',
          query: { type: 'todosQuery', payload: {} },
        })) {
          // Iteration must validate correlation before yielding the frame.
        }
      })(),
    ).rejects.toMatchObject({ code: 'SPECTER_TRANSPORT_FAILURE' })
  })

  it('rejects non-subscription protocol messages in an SSE stream', async () => {
    const client = createSpecterProtocolHttpClient('http://runtime', {
      requestId: () => 'request-1',
      fetch: async () =>
        new Response(
          `data: ${JSON.stringify({
            protocolVersion: 1,
            kind: 'query.response',
            requestId: 'request-1',
            operationId: 'operation-1',
            result: null,
          })}\n\n`,
        ),
    })

    await expect(
      (async () => {
        for await (const _frame of client.subscribe({
          operationId: 'operation-1',
          query: { type: 'todosQuery', payload: {} },
        })) {
          // Iteration must reject the unexpected frame kind.
        }
      })(),
    ).rejects.toThrow('mismatched subscription message kind')
  })

  it('surfaces only correlated typed subscription errors from non-success responses', async () => {
    const client = createSpecterProtocolHttpClient('http://runtime', {
      requestId: () => 'request-1',
      fetch: async () =>
        Response.json(
          {
            protocolVersion: 1,
            kind: 'subscription.error',
            requestId: 'request-1',
            operationId: 'operation-1',
            error: {
              code: 'SPECTER_UNKNOWN_QUERY',
              message: 'Query type is not registered.',
            },
          },
          { status: 404 },
        ),
    })

    await expect(
      (async () => {
        for await (const _frame of client.subscribe({
          operationId: 'operation-1',
          query: { type: 'missingQuery', payload: {} },
        })) {
          // A non-success response rejects before yielding.
        }
      })(),
    ).rejects.toMatchObject({
      code: 'SPECTER_UNKNOWN_QUERY',
      message: 'Query type is not registered.',
      status: 404,
    })
  })

  it.each([
    [
      'mismatched request',
      {
        protocolVersion: 1,
        kind: 'subscription.error',
        requestId: 'wrong-request',
        operationId: 'operation-1',
        error: { code: 'SPECTER_INTERNAL_ERROR', message: 'Failed.' },
      },
      'mismatched request ID',
    ],
    [
      'mismatched operation',
      {
        protocolVersion: 1,
        kind: 'subscription.error',
        requestId: 'request-1',
        operationId: 'wrong-operation',
        error: { code: 'SPECTER_INTERNAL_ERROR', message: 'Failed.' },
      },
      'mismatched operation ID',
    ],
    [
      'wrong protocol kind',
      {
        protocolVersion: 1,
        kind: 'query.response',
        requestId: 'request-1',
        operationId: 'operation-1',
        error: { code: 'SPECTER_INTERNAL_ERROR', message: 'Failed.' },
      },
      'mismatched subscription error kind',
    ],
  ])('rejects a %s non-success subscription response', async (_, body, error) => {
    const client = createSpecterProtocolHttpClient('http://runtime', {
      requestId: () => 'request-1',
      fetch: async () => Response.json(body, { status: 400 }),
    })

    await expect(
      (async () => {
        for await (const _frame of client.subscribe({
          operationId: 'operation-1',
          query: { type: 'todosQuery', payload: {} },
        })) {
          // A non-success response rejects before yielding.
        }
      })(),
    ).rejects.toThrow(error)
  })

  it('sanitizes generic non-success subscription bodies', async () => {
    const credential = 'postgres://admin:secret@database/subscriptions'
    const client = createSpecterProtocolHttpClient('http://runtime', {
      requestId: () => 'request-1',
      fetch: async () =>
        Response.json(
          {
            error: { code: 'DATABASE_FAILED', message: credential },
          },
          { status: 500 },
        ),
    })

    let failure: unknown
    try {
      for await (const _frame of client.subscribe({
        operationId: 'operation-1',
        query: { type: 'todosQuery', payload: {} },
      })) {
        // A non-success response rejects before yielding.
      }
    } catch (cause) {
      failure = cause
    }
    expect(failure).toMatchObject({ code: 'SPECTER_TRANSPORT_FAILURE' })
    expect(String(failure)).not.toContain(credential)
  })

  it('rejects a frame after an observable terminal subscription error', async () => {
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

    const received: string[] = []
    await expect(
      (async () => {
        for await (const frame of client.subscribe({
          operationId: 'operation-1',
          query: { type: 'todosQuery', payload: {} },
        }))
          received.push(frame.kind)
      })(),
    ).rejects.toThrow('frame after termination')

    expect(received).toEqual(['subscription.error'])
  })

  it.each([
    ['empty', []],
    [
      'value-only',
      [
        {
          protocolVersion: 1,
          kind: 'subscription.value',
          requestId: 'request-1',
          operationId: 'operation-1',
          sequence: 1,
          result: [],
        },
      ],
    ],
  ])('rejects a truncated %s subscription stream', async (_, frames) => {
    const body = frames
      .map((frame) => `data: ${JSON.stringify(frame)}\n\n`)
      .join('')
    const client = createSpecterProtocolHttpClient('http://runtime', {
      requestId: () => 'request-1',
      fetch: async () => new Response(body),
    })

    await expect(
      (async () => {
        for await (const _frame of client.subscribe({
          operationId: 'operation-1',
          query: { type: 'todosQuery', payload: {} },
        })) {
          // EOF must follow a terminal frame.
        }
      })(),
    ).rejects.toThrow('without a terminal frame')
  })

  it('allows caller cancellation without a terminal frame', async () => {
    const abort = new AbortController()
    const value = {
      protocolVersion: 1,
      kind: 'subscription.value',
      requestId: 'request-1',
      operationId: 'operation-1',
      sequence: 1,
      result: [],
    }
    const client = createSpecterProtocolHttpClient('http://runtime', {
      requestId: () => 'request-1',
      fetch: async () => new Response(`data: ${JSON.stringify(value)}\n\n`),
    })
    const iterator = client
      .subscribe(
        {
          operationId: 'operation-1',
          query: { type: 'todosQuery', payload: {} },
        },
        { signal: abort.signal },
      )
      [Symbol.asyncIterator]()

    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { kind: 'subscription.value' },
    })
    abort.abort()
    await expect(iterator.next()).resolves.toEqual({
      done: true,
      value: undefined,
    })
  })

  it('does not start a pre-cancelled subscription request', async () => {
    const abort = new AbortController()
    abort.abort()
    const fetch = vi.fn()
    const client = createSpecterProtocolHttpClient('http://runtime', {
      requestId: () => 'request-1',
      fetch,
    })
    const iterator = client
      .subscribe(
        {
          operationId: 'operation-1',
          query: { type: 'todosQuery', payload: {} },
        },
        { signal: abort.signal },
      )
      [Symbol.asyncIterator]()

    await expect(iterator.next()).resolves.toEqual({
      done: true,
      value: undefined,
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('accepts exactly one terminal subscription completion', async () => {
    const complete = {
      protocolVersion: 1,
      kind: 'subscription.complete',
      requestId: 'request-1',
      operationId: 'operation-1',
    }
    const client = createSpecterProtocolHttpClient('http://runtime', {
      requestId: () => 'request-1',
      fetch: async () => new Response(`data: ${JSON.stringify(complete)}\n\n`),
    })

    const received = []
    for await (const frame of client.subscribe({
      operationId: 'operation-1',
      query: { type: 'todosQuery', payload: {} },
    }))
      received.push(frame.kind)

    expect(received).toEqual(['subscription.complete'])
  })

  it('returns correlated typed errors when subscription setup fails', async () => {
    const credential = 'postgres://admin:secret@database/subscription-setup'
    const setupFailure = new Error(credential) as Error & { code: string }
    setupFailure.code = 'SPECTER_UNKNOWN_QUERY'
    const runtime = {
      runtime: { language: 'test', version: '1' },
      capabilities: ['query-subscriptions'],
      command: vi.fn(),
      query: vi.fn(),
      subscribe() {
        throw setupFailure
      },
      reactionTicket: vi.fn(),
      ingestObservations: vi.fn(),
    } as unknown as ProtocolRuntimeAdapter
    const handler = createSpecterProtocolHttpHandler({ runtime })
    const client = createSpecterProtocolHttpClient(
      'http://runtime/specter/v1',
      {
        requestId: () => 'subscription-request',
        fetch: (input, init) => handler(new Request(input, init)),
      },
    )

    let failure: unknown
    try {
      for await (const _frame of client.subscribe({
        operationId: 'subscription-operation',
        query: { type: 'missingQuery', payload: {} },
      })) {
        // Setup failures reject before a stream is established.
      }
    } catch (cause) {
      failure = cause
    }

    expect(failure).toMatchObject({
      code: 'SPECTER_UNKNOWN_QUERY',
      message: 'Query type is not registered.',
      status: 400,
    })
    expect(String(failure)).not.toContain(credential)
  })

  it('requires exactly application/json as the parsed media type on every POST route', async () => {
    const runtime = {
      runtime: { language: 'test', version: '1' },
      capabilities: [],
      command: vi.fn(),
      query: vi.fn(),
      subscribe: vi.fn(),
      reactionTicket: vi.fn(),
      ingestObservations: vi.fn(),
    } as unknown as ProtocolRuntimeAdapter
    const handler = createSpecterProtocolHttpHandler({ runtime })
    const requests = [
      [
        '/capabilities',
        {
          protocolVersion: 1,
          kind: 'capabilities.request',
          requestId: 'capabilities-request',
        },
      ],
      [
        '/commands',
        {
          protocolVersion: 1,
          kind: 'command.request',
          requestId: 'command-request',
          operationId: 'command-operation',
          command: { type: 'addTodo', payload: {} },
        },
      ],
      [
        '/queries',
        {
          protocolVersion: 1,
          kind: 'query.request',
          requestId: 'query-request',
          operationId: 'query-operation',
          query: { type: 'todosQuery', payload: {} },
        },
      ],
      [
        '/subscriptions',
        {
          protocolVersion: 1,
          kind: 'subscription.request',
          requestId: 'subscription-request',
          operationId: 'subscription-operation',
          query: { type: 'todosQuery', payload: {} },
        },
      ],
      [
        '/observations',
        {
          protocolVersion: 1,
          kind: 'observations.batch',
          requestId: 'observations-request',
          observations: [],
        },
      ],
    ] as const

    for (const [path, body] of requests) {
      for (const contentType of [
        undefined,
        'text/plain',
        'application/jsonx',
      ]) {
        const response = await handler(
          new Request(`http://localhost/specter/v1${path}`, {
            method: 'POST',
            headers: contentType ? { 'content-type': contentType } : {},
            body: JSON.stringify(body),
          }),
        )
        expect(response.status, `${path} with ${String(contentType)}`).toBe(415)
        expect(await response.json()).toMatchObject({
          error: { code: 'SPECTER_INVALID_MESSAGE' },
        })
      }
    }

    const accepted = await handler(
      new Request('http://localhost/specter/v1/capabilities', {
        method: 'POST',
        headers: {
          'content-type': 'Application/JSON; charset=utf-8; profile="v1"',
        },
        body: JSON.stringify({
          protocolVersion: 1,
          kind: 'capabilities.request',
          requestId: 'accepted-request',
        }),
      }),
    )
    expect(accepted.status).toBe(200)
  })

  it('distinguishes malformed JSON from an unsupported media type', async () => {
    const runtime = {
      runtime: { language: 'test', version: '1' },
      capabilities: [],
    } as unknown as ProtocolRuntimeAdapter
    const response = await createSpecterProtocolHttpHandler({ runtime })(
      new Request('http://localhost/specter/v1/capabilities', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{not-json',
      }),
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: { code: 'SPECTER_INVALID_JSON' },
    })
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
        headers: { 'content-type': 'application/json' },
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
        headers: { 'content-type': 'application/json' },
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
        headers: { 'content-type': 'application/json' },
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
        headers: { 'content-type': 'application/json' },
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
        headers: { 'content-type': 'application/json' },
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

  it('preserves protocol causality in observed Command, Query, and subscription operations', async () => {
    const observations: SpecterObservation[] = []
    const registeredEvent = createEventDefinition('registered-event', {
      '~standard': {
        version: 1,
        vendor: 'protocol-observation-test',
        validate: (value: unknown) => ({ value }),
      },
    } as never)
    const store = {
      async get() {
        return {
          write: {},
          read: {},
          lastAppliedOrder: async () => 0,
          setLastAppliedOrder: async () => undefined,
        }
      },
      async transaction(sliceName: string, run: (store: unknown) => unknown) {
        return run(await this.get(sliceName))
      },
    }
    const registeredCommand = createCommandSlice('registeredCommand')
      .description('Satisfies the runtime registration contract.')
      .scenarios({
        description: 'Emits the registered Event.',
        given: [],
        when: {},
        expect: [event('registered-event', {})],
      })
      .inputSchema<Record<string, never>>()
      .store(store as never)
      .handle(async () => [registeredEvent.create({})])
    const eventLog = {
      async query() {
        return []
      },
      async currentVersion() {
        return 0
      },
      async findCommit() {
        return undefined
      },
      async append() {
        throw new Error('No registered Command can append Events.')
      },
      async transaction(run) {
        return run(eventLog)
      },
    } satisfies EventLogAdapter
    const app = await createSpecterApp({
      events: [registeredEvent],
      eventLog,
      schedule: () => () => () => Promise.resolve(),
      slices: [registeredCommand],
      observe: (observation) => observations.push(observation),
      runtime: {
        generateId: (() => {
          let id = 0
          return () => `observation-${++id}`
        })(),
        now: () => 0,
      },
    })
    const adapter = createSpecterRuntimeProtocolAdapter({
      app,
      eventLog,
      runtimeVersion: 'test',
    })
    const causality = {
      correlationId: 'correlation-1',
      parentOperationIds: ['parent-1'],
      triggeringEventIds: ['event-1'],
      triggeringEventOrder: { from: 4, to: 7 },
      reactionPassId: 'pass-1',
      deliveryId: 'delivery-1',
      attemptId: 'attempt-2',
    }

    await expect(
      adapter.command({
        protocolVersion: 1,
        kind: 'command.request',
        requestId: 'command-request',
        operationId: 'command-operation',
        command: { type: 'missingCommand', payload: {} },
        ...causality,
      }),
    ).resolves.toMatchObject({ status: 'rejected' })
    await expect(
      adapter.query({
        protocolVersion: 1,
        kind: 'query.request',
        requestId: 'query-request',
        operationId: 'query-operation',
        query: { type: 'missingQuery', payload: {} },
        ...causality,
      }),
    ).rejects.toBeDefined()
    expect(() =>
      adapter.subscribe(
        {
          protocolVersion: 1,
          kind: 'subscription.request',
          requestId: 'subscription-request',
          operationId: 'subscription-operation',
          query: { type: 'missingSubscription', payload: {} },
          ...causality,
        },
        { signal: new AbortController().signal },
      ),
    ).toThrow()

    for (const operationId of [
      'command-operation',
      'query-operation',
      'subscription-operation',
    ]) {
      const operationObservations = observations.filter(
        (observation) => observation.operationId === operationId,
      )
      expect(operationObservations).toHaveLength(2)
      expect(operationObservations).toEqual([
        expect.objectContaining({
          operationId,
          correlationId: causality.correlationId,
          parentOperationIds: causality.parentOperationIds,
          protocolCausality: {
            triggeringEventIds: causality.triggeringEventIds,
            triggeringEventOrder: causality.triggeringEventOrder,
            reactionPassId: causality.reactionPassId,
            deliveryId: causality.deliveryId,
            attemptId: causality.attemptId,
          },
        }),
        expect.objectContaining({
          operationId,
          protocolCausality: {
            triggeringEventIds: causality.triggeringEventIds,
            triggeringEventOrder: causality.triggeringEventOrder,
            reactionPassId: causality.reactionPassId,
            deliveryId: causality.deliveryId,
            attemptId: causality.attemptId,
          },
        }),
      ])
    }
  })

  it('forwards language-neutral causality into successful adapter operations', async () => {
    const received: unknown[] = []
    const app = {
      async command(_envelope: unknown, options: unknown) {
        received.push(options)
        return {
          operationId: 'command-operation',
          events: [],
          version: 1,
          duplicate: false,
          reactions: Promise.resolve(),
        }
      },
      async query(_envelope: unknown, options: unknown) {
        received.push(options)
        return null
      },
      subscribe(_envelope: unknown, options: unknown) {
        received.push(options)
        return {
          async *[Symbol.asyncIterator]() {
            yield null
          },
        }
      },
    }
    const adapter = createSpecterRuntimeProtocolAdapter({
      app: app as never,
      eventLog: { currentVersion: async () => 1 } as never,
      runtimeVersion: 'test',
    })
    const causality = {
      correlationId: 'correlation-1',
      parentOperationIds: ['parent-1'],
      triggeringEventIds: ['event-1'],
      triggeringEventOrder: { from: 4, to: 7 },
      reactionPassId: 'pass-1',
      deliveryId: 'delivery-1',
      attemptId: 'attempt-2',
    }

    await adapter.command({
      protocolVersion: 1,
      kind: 'command.request',
      requestId: 'command-request',
      operationId: 'command-operation',
      command: { type: 'addTodo', payload: {} },
      ...causality,
    })
    await adapter.query({
      protocolVersion: 1,
      kind: 'query.request',
      requestId: 'query-request',
      operationId: 'query-operation',
      query: { type: 'todosQuery', payload: {} },
      ...causality,
    })
    const subscription = adapter.subscribe(
      {
        protocolVersion: 1,
        kind: 'subscription.request',
        requestId: 'subscription-request',
        operationId: 'subscription-operation',
        query: { type: 'todosQuery', payload: {} },
        ...causality,
      },
      { signal: new AbortController().signal },
    )
    await subscription[Symbol.asyncIterator]().next()

    expect(received).toHaveLength(3)
    for (const options of received) {
      expect(options).toMatchObject({
        correlationId: causality.correlationId,
        parentOperationIds: causality.parentOperationIds,
        protocolCausality: {
          triggeringEventIds: causality.triggeringEventIds,
          triggeringEventOrder: causality.triggeringEventOrder,
          reactionPassId: causality.reactionPassId,
          deliveryId: causality.deliveryId,
          attemptId: causality.attemptId,
        },
      })
    }
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

  it('starts Reaction ticket retention only after a pending Reaction settles', async () => {
    vi.useFakeTimers()
    try {
      let settleReaction!: () => void
      const reactions = new Promise<void>((resolve) => {
        settleReaction = resolve
      })
      const adapter = createSpecterRuntimeProtocolAdapter({
        app: {
          async command() {
            return {
              operationId: 'operation-pending',
              events: [],
              version: 1,
              duplicate: false,
              reactions,
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
        requestId: 'request-pending',
        operationId: 'operation-pending',
        command: { type: 'addTodo', payload: {} },
      })
      const ticketId = command.reactionTicketId as string

      expect(vi.getTimerCount()).toBe(0)
      await vi.advanceTimersByTimeAsync(10_000)
      await expect(adapter.reactionTicket(ticketId)).resolves.toEqual({
        status: 'pending',
      })

      settleReaction()
      await reactions
      await Promise.resolve()

      await expect(adapter.reactionTicket(ticketId)).resolves.toEqual({
        status: 'completed',
      })
      expect(vi.getTimerCount()).toBe(1)
      await vi.advanceTimersByTimeAsync(24)
      await expect(adapter.reactionTicket(ticketId)).resolves.toEqual({
        status: 'completed',
      })
      await vi.advanceTimersByTimeAsync(1)
      await expect(adapter.reactionTicket(ticketId)).resolves.toMatchObject({
        status: 'failed',
        error: { code: 'SPECTER_REACTION_TICKET_NOT_FOUND' },
      })
    } finally {
      vi.useRealTimers()
    }
  })
})

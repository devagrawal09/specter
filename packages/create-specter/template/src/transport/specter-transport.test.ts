import { createClient } from '@libsql/client/sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import { createSpecterBrowserTransport } from './specter-browser'
import { createSpecterHttpHandler } from './specter-http.server'
import {
  createSqliteReactionTicketStore,
  prepareSqliteReactionTicketStore,
} from './specter-reaction-tickets-sqlite.server'

const subscriptionRequest = () =>
  new Request('http://specter.test/api/subscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      envelope: { type: 'todosQuery', payload: {} },
    }),
  })

function fakeSubscriptionApp(
  iterator: AsyncIterator<unknown>,
): Parameters<typeof createSpecterHttpHandler>[0]['app'] {
  return {
    command: vi.fn(),
    query: vi.fn(),
    subscribe: () => ({
      [Symbol.asyncIterator]: () => iterator,
    }),
  } as unknown as Parameters<typeof createSpecterHttpHandler>[0]['app']
}

describe('Specter SSE lifecycle', () => {
  it('returns the server iterator after natural completion', async () => {
    const returnIterator = vi.fn(async () => ({
      done: true as const,
      value: undefined,
    }))
    const next = vi
      .fn<() => Promise<IteratorResult<unknown>>>()
      .mockResolvedValueOnce({ done: false, value: { count: 1 } })
      .mockResolvedValueOnce({ done: true, value: undefined })
    const handler = createSpecterHttpHandler({
      app: fakeSubscriptionApp({ next, return: returnIterator }),
      basePath: '/api',
    })

    const response = await handler(subscriptionRequest())
    expect(await response.text()).toContain('data: {"count":1}')
    expect(returnIterator).toHaveBeenCalledTimes(1)
  })

  it('returns the server iterator after an iteration error', async () => {
    const returnIterator = vi.fn(async () => ({
      done: true as const,
      value: undefined,
    }))
    const handler = createSpecterHttpHandler({
      app: fakeSubscriptionApp({
        next: vi.fn(async () => {
          throw new Error('subscription failed')
        }),
        return: returnIterator,
      }),
      basePath: '/api',
    })

    const response = await handler(subscriptionRequest())
    expect(await response.text()).toContain('event: error')
    expect(returnIterator).toHaveBeenCalledTimes(1)
  })

  it('cancels the response body when the browser iterator returns early', async () => {
    const cancel = vi.fn()
    const fetch = vi.fn(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode('event: value\ndata: {"count":1}\n\n'),
              )
            },
            cancel,
          }),
          {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
          },
        ),
    ) as unknown as typeof globalThis.fetch
    const transport = createSpecterBrowserTransport('/api', { fetch })
    const iterator = transport
      .subscribe({ type: 'todosQuery', payload: {} } as never)
      [Symbol.asyncIterator]()

    expect(await iterator.next()).toEqual({
      done: false,
      value: { count: 1 },
    })
    await iterator.return?.()

    expect(cancel).toHaveBeenCalledTimes(1)
  })
})

describe('durable Reaction completion tickets', () => {
  it('recovers a pending ticket after a server restart through idempotent redispatch', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'specter-reaction-ticket-'))
    const client = createClient({
      url: `file:${join(directory, 'tickets.db')}`,
    })
    const neverSettles = new Promise<void>(() => {})

    try {
      await prepareSqliteReactionTicketStore(client)
      const firstApp = {
        command: vi.fn(async () => ({
          events: [],
          version: 1,
          duplicate: false,
          reactions: neverSettles,
        })),
        query: vi.fn(),
        subscribe: vi.fn(),
      }
      const firstHandler = createSpecterHttpHandler({
        app: firstApp as never,
        basePath: '/api',
        reactionTickets: createSqliteReactionTicketStore(client),
      })
      const commandResponse = await firstHandler(
        new Request('http://specter.test/api/command', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            envelope: { type: 'addTodo', payload: { todoId: 'todo-1' } },
          }),
        }),
      )
      const { reactionId } = (await commandResponse.json()) as {
        reactionId: string
      }

      const recoveredApp = {
        command: vi.fn(async () => ({
          events: [],
          version: 1,
          duplicate: true,
          reactions: Promise.resolve(),
        })),
        query: vi.fn(),
        subscribe: vi.fn(),
      }
      const recoveredHandler = createSpecterHttpHandler({
        app: recoveredApp as never,
        basePath: '/api',
        reactionTickets: createSqliteReactionTicketStore(client),
      })

      const recoveryResponse = await recoveredHandler(
        new Request(`http://specter.test/api/reactions/${reactionId}`),
      )

      expect(recoveryResponse.status).toBe(204)
      expect(recoveredApp.command).toHaveBeenCalledWith(
        { type: 'addTodo', payload: { todoId: 'todo-1' } },
        { idempotencyKey: reactionId },
      )
      expect(
        await createSqliteReactionTicketStore(client).get(reactionId),
      ).toEqual({ status: 'settled', result: { ok: true } })
    } finally {
      client.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

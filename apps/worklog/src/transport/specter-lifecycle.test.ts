import type { SpecterApp } from '@specter-ts/core'
import { expect, test, vi } from 'vitest'

import type { WorklogAppConfig } from '../features/worklog/registry'
import { createSpecterBrowserTransport } from './specter-browser'
import { createSpecterHttpHandler } from './specter-http.server'
import {
  specterClientHeader,
  specterClientHeaderValue,
} from './specter-protocol'

const queryEnvelope = {
  type: 'tasksQuery' as const,
  payload: { status: 'all' as const, topicId: null },
}

test('server returns the subscription iterator after natural completion', async () => {
  const iterator = lifecycleIterator({ doneImmediately: true })
  const handler = handlerFor(iterator)

  const response = await handler(trustedSubscriptionRequest())
  expect(await response.text()).toBe('')

  expect(iterator.return).toHaveBeenCalledOnce()
  expect(handler.activeSubscriptionCount()).toBe(0)
})

test('server returns the subscription iterator after an iteration error', async () => {
  const iterator = lifecycleIterator({ iterationError: new Error('broken') })
  const handler = handlerFor(iterator)

  const response = await handler(trustedSubscriptionRequest())
  expect(await response.text()).toContain('event: error')

  expect(iterator.return).toHaveBeenCalledOnce()
  expect(handler.activeSubscriptionCount()).toBe(0)
})

test('server cleans up a subscription when its request is aborted', async () => {
  const requestController = new AbortController()
  const iterator = lifecycleIterator()
  const handler = handlerFor(iterator)
  const response = await handler(
    trustedSubscriptionRequest(requestController.signal),
  )
  const reader = response.body?.getReader()
  expect((await reader?.read())?.done).toBe(false)
  expect(handler.activeSubscriptionCount()).toBe(1)

  requestController.abort(new Error('request disconnected'))
  await vi.waitFor(() => expect(iterator.return).toHaveBeenCalledOnce())
  await vi.waitFor(() => expect(handler.activeSubscriptionCount()).toBe(0))
})

test('server cleans up a subscription when the response reader cancels', async () => {
  const iterator = lifecycleIterator()
  const handler = handlerFor(iterator)
  const response = await handler(trustedSubscriptionRequest())
  const reader = response.body?.getReader()
  expect((await reader?.read())?.done).toBe(false)

  await reader?.cancel('client closed stream')
  expect(iterator.return).toHaveBeenCalledOnce()
  expect(handler.activeSubscriptionCount()).toBe(0)
})

test('server shutdown closes every active subscription', async () => {
  const iterator = lifecycleIterator()
  const handler = handlerFor(iterator)
  const response = await handler(trustedSubscriptionRequest())
  const reader = response.body?.getReader()
  expect((await reader?.read())?.done).toBe(false)
  expect(handler.activeSubscriptionCount()).toBe(1)

  await handler.close(new Error('shutdown'))
  expect(iterator.return).toHaveBeenCalledOnce()
  expect(handler.activeSubscriptionCount()).toBe(0)
})

test('server shutdown makes an unread queued response terminal', async () => {
  let nextCalls = 0
  const iterator = {
    next: vi.fn(async () => {
      nextCalls += 1
      if (nextCalls === 1) {
        return { done: false as const, value: [] }
      }
      throw new Error('iterator advanced after shutdown cleanup')
    }),
    return: vi.fn(async () => ({ done: true as const, value: undefined })),
  }
  let runCalls = 0
  const run = async <T>(operation: () => Promise<T>): Promise<T> => {
    runCalls += 1
    return operation()
  }
  const app = {
    subscribe: vi.fn(() => ({
      [Symbol.asyncIterator]: () => iterator,
    })),
  } as unknown as SpecterApp<WorklogAppConfig>
  const handler = createSpecterHttpHandler({
    app,
    basePath: '/api',
    run,
  })

  const response = await handler(trustedSubscriptionRequest())
  await vi.waitFor(() => expect(iterator.next).toHaveBeenCalledOnce())
  await Promise.resolve()

  await handler.close(new Error('shutdown'))
  const nextCallsAfterClose = iterator.next.mock.calls.length
  const runCallsAfterClose = runCalls

  await expect(response.text()).resolves.toBe('event: value\ndata: []\n\n')
  expect(iterator.next).toHaveBeenCalledTimes(nextCallsAfterClose)
  expect(runCalls).toBe(runCallsAfterClose)
  expect(iterator.return).toHaveBeenCalledOnce()
  expect(handler.activeSubscriptionCount()).toBe(0)
})

test('server shutdown prevents a body-paused request from registering late', async () => {
  const iterator = lifecycleIterator()
  const subscribe = vi.fn(() => ({
    [Symbol.asyncIterator]: () => iterator,
  }))
  const app = { subscribe } as unknown as SpecterApp<WorklogAppConfig>
  const handler = createSpecterHttpHandler({ app, basePath: '/api' })
  const request = trustedSubscriptionRequest()
  const bodyReadStarted = deferred<void>()
  const body = deferred<{ envelope: typeof queryEnvelope }>()
  vi.spyOn(request, 'json').mockImplementation(async () => {
    bodyReadStarted.resolve()
    return body.promise
  })

  const responsePromise = handler(request)
  await bodyReadStarted.promise
  await handler.close(new Error('shutdown'))
  body.resolve({ envelope: queryEnvelope })

  const response = await responsePromise
  expect(response.status).toBe(503)
  await expect(response.json()).resolves.toMatchObject({
    error: { code: 'SPECTER_TRANSPORT_CLOSING' },
  })
  expect(subscribe).not.toHaveBeenCalled()
  expect(iterator.return).not.toHaveBeenCalled()
  expect(handler.activeSubscriptionCount()).toBe(0)
})

test('server owns a subscription before the resolved body continuation runs', async () => {
  const iterator = lifecycleIterator()
  const subscribe = vi.fn(() => ({
    [Symbol.asyncIterator]: () => iterator,
  }))
  const app = { subscribe } as unknown as SpecterApp<WorklogAppConfig>
  const handler = createSpecterHttpHandler({ app, basePath: '/api' })
  const request = trustedSubscriptionRequest()
  const body = deferred<{ envelope: typeof queryEnvelope }>()
  vi.spyOn(request, 'json').mockImplementation(() => body.promise)

  const responsePromise = handler(request)
  body.resolve({ envelope: queryEnvelope })
  // Let readJsonBody settle while handleSubscription remains queued behind it.
  await Promise.resolve()

  let closeSettled = false
  const closePromise = handler.close(new Error('shutdown')).then(() => {
    closeSettled = true
  })
  await Promise.resolve()
  await Promise.resolve()
  expect(closeSettled).toBe(false)

  const response = await responsePromise
  await closePromise
  expect(response.status).toBe(503)
  await expect(response.json()).resolves.toMatchObject({
    error: { code: 'SPECTER_TRANSPORT_CLOSING' },
  })
  expect(subscribe).not.toHaveBeenCalled()
  expect(iterator.return).not.toHaveBeenCalled()
  expect(handler.activeSubscriptionCount()).toBe(0)
})

test('server shutdown waits for iterator setup and cleans up its late result', async () => {
  const iterator = lifecycleIterator()
  const setupStarted = deferred<void>()
  const continueSetup = deferred<void>()
  const app = {
    subscribe: vi.fn(() => ({
      [Symbol.asyncIterator]: () => iterator,
    })),
  } as unknown as SpecterApp<WorklogAppConfig>
  const handler = createSpecterHttpHandler({
    app,
    basePath: '/api',
    run: async <T>(operation: () => Promise<T>) => {
      setupStarted.resolve()
      await continueSetup.promise
      return operation()
    },
  })

  const responsePromise = handler(trustedSubscriptionRequest())
  await setupStarted.promise
  const closePromise = handler.close(new Error('shutdown'))
  let closeSettled = false
  void closePromise.then(() => {
    closeSettled = true
  })
  await Promise.resolve()
  expect(closeSettled).toBe(false)

  continueSetup.resolve()
  await closePromise
  const response = await responsePromise

  expect(response.status).toBe(503)
  expect(iterator.return).toHaveBeenCalledOnce()
  expect(handler.activeSubscriptionCount()).toBe(0)
})

test('request abort reaches a subscription while iterator setup is stalled', async () => {
  const iterator = lifecycleIterator()
  const setupStalled = deferred<void>()
  const continueSetup = deferred<void>()
  let subscriptionSignal: AbortSignal | undefined
  const app = {
    subscribe: vi.fn((...args: unknown[]) => {
      subscriptionSignal = (args[1] as { signal: AbortSignal }).signal
      return {
        [Symbol.asyncIterator]: () => iterator,
      }
    }),
  } as unknown as SpecterApp<WorklogAppConfig>
  const handler = createSpecterHttpHandler({
    app,
    basePath: '/api',
    run: async <T>(operation: () => Promise<T>) => {
      const result = await operation()
      setupStalled.resolve()
      await continueSetup.promise
      return result
    },
  })
  const requestController = new AbortController()

  const responsePromise = handler(
    trustedSubscriptionRequest(requestController.signal),
  )
  await setupStalled.promise
  expect(subscriptionSignal?.aborted).toBe(false)

  requestController.abort(new Error('request disconnected during setup'))
  expect(subscriptionSignal?.aborted).toBe(true)

  let responseSettled = false
  void responsePromise.then(() => {
    responseSettled = true
  })
  await Promise.resolve()
  expect(responseSettled).toBe(false)

  continueSetup.resolve()
  const response = await responsePromise
  await expect(response.text()).resolves.toBe('')
  expect(iterator.return).toHaveBeenCalledOnce()
  expect(handler.activeSubscriptionCount()).toBe(0)
})

test('browser iterator return cancels the active response stream', async () => {
  const cancel = vi.fn()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('event: value\ndata: []\n\n'))
    },
    cancel,
  })
  const fetchImplementation = vi.fn(
    async () =>
      new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
  )
  const transport = createSpecterBrowserTransport<WorklogAppConfig>('/api', {
    fetch: fetchImplementation,
    reconnectDelayMs: 1,
  })
  const iterator = transport.subscribe(queryEnvelope)[Symbol.asyncIterator]()

  expect((await iterator.next()).value).toEqual([])
  await iterator.return?.()

  expect(cancel).toHaveBeenCalledOnce()
})

function handlerFor(
  iterator: AsyncIterator<unknown> & {
    return: ReturnType<typeof vi.fn>
  },
) {
  const app = {
    subscribe: vi.fn(() => ({
      [Symbol.asyncIterator]: () => iterator,
    })),
  } as unknown as SpecterApp<WorklogAppConfig>
  return createSpecterHttpHandler({ app, basePath: '/api' })
}

function trustedSubscriptionRequest(signal?: AbortSignal) {
  return new Request('http://127.0.0.1/api/subscribe', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [specterClientHeader]: specterClientHeaderValue,
    },
    body: JSON.stringify({ envelope: queryEnvelope }),
    signal,
  })
}

function lifecycleIterator(
  options: {
    readonly doneImmediately?: boolean
    readonly iterationError?: Error
  } = {},
) {
  let returned = false
  let calls = 0
  let resolvePending: (() => void) | undefined
  const returnIterator = vi.fn(async () => {
    returned = true
    resolvePending?.()
    return { done: true as const, value: undefined }
  })
  return {
    async next() {
      calls += 1
      if (options.iterationError) throw options.iterationError
      if (options.doneImmediately || returned)
        return { done: true as const, value: undefined }
      if (calls === 1) return { done: false as const, value: [] }
      await new Promise<void>((resolve) => {
        resolvePending = resolve
      })
      return { done: true as const, value: undefined }
    },
    return: returnIterator,
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

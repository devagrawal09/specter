import { describe, expect, it, vi } from 'vitest'

import { createMemoryReactionOutboxStore } from './memory-store'
import { createOutboxReactionPlugin } from './plugin'
import { createDurableReactionScheduler } from './scheduler'
import {
  createReactionOutboxWorker,
  ReactionOutboxDrainFailure,
  runReactionOutboxWorker,
} from './worker'
import { ReactionOutboxLeaseLostError } from './errors'

describe('Reaction outbox worker', () => {
  it('allows arbitrary in-process payloads in the memory store', async () => {
    const store = createMemoryReactionOutboxStore<() => string>()
    const effect = () => 'local effect'
    const worker = createReactionOutboxWorker({
      store,
      idFactory: () => 'job-1',
      handle: async (payload) => {
        expect(payload).toBe(effect)
      },
    })

    await worker.enqueue(effect)
    await worker.drain()

    expect((await store.get('job-1'))?.payload).toBe(effect)
  })

  it('deduplicates enqueue requests and uses deterministic attempt IDs', async () => {
    const store = createMemoryReactionOutboxStore<{ message: string }>()
    const attempts: string[] = []
    const worker = createReactionOutboxWorker({
      store,
      idFactory: () => 'job-1',
      handle: async (_payload, context) => {
        attempts.push(context.attemptId)
      },
    })

    await worker.enqueue(
      { message: 'hello' },
      { jobId: 'job-1', idempotencyKey: 'command-1:email' },
    )
    const duplicate = await worker.enqueue(
      { message: 'ignored' },
      { jobId: 'job-2', idempotencyKey: 'command-1:email' },
    )
    await worker.drain()

    expect(duplicate).toEqual({ jobId: 'job-1', created: false })
    expect(attempts).toEqual(['job-1:attempt:1'])
    expect(await store.get('job-1')).toMatchObject({
      status: 'completed',
      attemptCount: 1,
      payload: { message: 'hello' },
    })
  })

  it('retries with backoff before moving a failed job to dead-letter', async () => {
    const store = createMemoryReactionOutboxStore<{ message: string }>()
    let currentTime = 0
    const sleeps: number[] = []
    const handle = vi.fn(async () => {
      throw new Error('mail provider unavailable')
    })
    const worker = createReactionOutboxWorker({
      store,
      handle,
      maxAttempts: 3,
      backoffMs: (attempt) => attempt * 10,
      now: () => new Date(currentTime),
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds)
        currentTime += milliseconds
      },
      idFactory: () => 'job-1',
    })

    await worker.enqueue({ message: 'hello' })

    await expect(worker.drain()).rejects.toBeInstanceOf(
      ReactionOutboxDrainFailure,
    )
    expect(handle).toHaveBeenCalledTimes(3)
    expect(sleeps).toEqual([10, 20])
    expect(await store.get('job-1')).toMatchObject({
      status: 'dead-letter',
      attemptCount: 3,
      lastError: 'mail provider unavailable',
    })
  })

  it('requeues expired leases and supports explicit dead-letter replay', async () => {
    const store = createMemoryReactionOutboxStore<{ message: string }>()
    const first = createReactionOutboxWorker({
      store,
      handle: async () => {
        throw new Error('first failure')
      },
      maxAttempts: 1,
      now: () => new Date(0),
      idFactory: () => 'job-1',
    })
    await first.enqueue({ message: 'hello' })
    await expect(first.drain()).rejects.toBeInstanceOf(
      ReactionOutboxDrainFailure,
    )

    const handled: string[] = []
    const second = createReactionOutboxWorker({
      store,
      handle: async (payload) => {
        handled.push(payload.message)
      },
      now: () => new Date(1),
    })
    await second.retryDeadLetter('job-1')
    await second.drain()

    expect(handled).toEqual(['hello'])
    expect(await store.get('job-1')).toMatchObject({
      status: 'completed',
      attemptCount: 2,
    })
  })

  it('does not let a failing transition observer change delivery', async () => {
    const store = createMemoryReactionOutboxStore<{ message: string }>()
    const handled: string[] = []
    const worker = createReactionOutboxWorker({
      store,
      idFactory: () => 'job-1',
      handle: async (payload) => {
        handled.push(payload.message)
      },
      onTransition: () => {
        throw new Error('telemetry offline')
      },
    })

    await worker.enqueue({ message: 'hello' })
    await worker.drain()

    expect(handled).toEqual(['hello'])
    expect(await store.get('job-1')).toMatchObject({ status: 'completed' })
  })

  it('stops cleanly without claiming work when its lifecycle is aborted', async () => {
    const store = createMemoryReactionOutboxStore<{ message: string }>()
    await store.enqueue({
      id: 'job-1',
      idempotencyKey: 'job-1',
      payload: { message: 'leave pending' },
      requestedAt: new Date(0),
      availableAt: new Date(0),
    })
    const controller = new AbortController()
    controller.abort()
    const worker = createReactionOutboxWorker({
      store,
      signal: controller.signal,
      handle: async () => {
        throw new Error('must not run')
      },
    })

    await worker.drain()

    expect(await store.get('job-1')).toMatchObject({ status: 'pending' })
  })

  it('waits for and reclaims a running job after its crash lease expires', async () => {
    const store = createMemoryReactionOutboxStore<{ message: string }>()
    await store.enqueue({
      id: 'job-1',
      idempotencyKey: 'job-1',
      payload: { message: 'recover me' },
      requestedAt: new Date(0),
      availableAt: new Date(0),
    })
    await store.claimNext(new Date(0), new Date(25))
    let currentTime = 0
    const handled: string[] = []
    const worker = createReactionOutboxWorker({
      store,
      now: () => new Date(currentTime),
      sleep: async (milliseconds) => {
        currentTime += milliseconds
      },
      handle: async (payload) => {
        handled.push(payload.message)
      },
    })

    await worker.drain()

    expect(currentTime).toBe(25)
    expect(handled).toEqual(['recover me'])
    expect(await store.get('job-1')).toMatchObject({
      status: 'completed',
      attemptCount: 2,
    })
  })

  it('rejects completion from a worker that lost its attempt lease', async () => {
    const store = createMemoryReactionOutboxStore<{ message: string }>()
    await store.enqueue({
      id: 'job-1',
      idempotencyKey: 'job-1',
      payload: { message: 'work' },
      requestedAt: new Date(0),
      availableAt: new Date(0),
    })
    const first = await store.claimNext(new Date(0), new Date(10))
    await store.requeueExpired(new Date(10))
    const second = await store.claimNext(new Date(10), new Date(20))

    await expect(
      store.complete(
        'job-1',
        first?.activeAttemptId ?? 'missing',
        new Date(11),
      ),
    ).rejects.toBeInstanceOf(ReactionOutboxLeaseLostError)
    await store.complete(
      'job-1',
      second?.activeAttemptId ?? 'missing',
      new Date(12),
    )
    expect(await store.get('job-1')).toMatchObject({ status: 'completed' })
  })

  it('runs as a polling service until its lifecycle is aborted', async () => {
    const store = createMemoryReactionOutboxStore<{ message: string }>()
    const handled: string[] = []
    const worker = createReactionOutboxWorker({
      store,
      handle: async (payload) => {
        handled.push(payload.message)
      },
    })
    await worker.enqueue(
      { message: 'from another process' },
      { jobId: 'job-1' },
    )
    const controller = new AbortController()

    await runReactionOutboxWorker(worker, {
      signal: controller.signal,
      sleep: async () => controller.abort(),
    })

    expect(handled).toEqual(['from another process'])
  })
})

describe('durable Reaction scheduler compatibility', () => {
  it('settles the idle promise only after a queued pass succeeds', async () => {
    const store = createMemoryReactionOutboxStore<{
      kind: 'reaction-pass'
    }>()
    const run = vi.fn(async () => {})
    const request = createDurableReactionScheduler(store, {
      idFactory: () => 'pass-1',
      now: () => new Date(0),
    })(run)

    await request()()

    expect(run).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledWith({
      deliveryId: 'pass-1',
      scheduledAt: new Date(0).toISOString(),
      attemptId: 'pass-1:attempt:1',
      attemptNumber: 1,
    })
    expect(await store.get('pass-1')).toMatchObject({ status: 'completed' })
  })

  it('keeps the delivery ID stable while changing attempt metadata on retry', async () => {
    const store = createMemoryReactionOutboxStore<{
      kind: 'reaction-pass'
    }>()
    const contexts: Array<{
      deliveryId: string
      scheduledAt: string
      attemptId: string
      attemptNumber: number
    }> = []
    const request = createDurableReactionScheduler(store, {
      idFactory: () => 'pass-1',
      maxAttempts: 2,
      backoffMs: () => 0,
      now: () => new Date(0),
    })(async (context) => {
      contexts.push(context)
      if (context.attemptNumber === 1) throw new Error('temporary failure')
    })

    await request()()

    expect(contexts).toEqual([
      {
        deliveryId: 'pass-1',
        scheduledAt: new Date(0).toISOString(),
        attemptId: 'pass-1:attempt:1',
        attemptNumber: 1,
      },
      {
        deliveryId: 'pass-1',
        scheduledAt: new Date(0).toISOString(),
        attemptId: 'pass-1:attempt:2',
        attemptNumber: 2,
      },
    ])
    expect(await store.get('pass-1')).toMatchObject({
      status: 'completed',
      attemptCount: 2,
    })
  })
})

describe('outbox Reaction Plugin', () => {
  it('deduplicates a retried Reaction by its stable delivery ID', async () => {
    const store = createMemoryReactionOutboxStore<{ message: string }>()
    const plugin = createOutboxReactionPlugin({ store })
    const exec = await plugin(async () => {})
    const context = {
      deliveryId: 'sendEmail:order-1:7',
      scheduledAt: '2026-07-16T00:00:00.000Z',
      attemptId: 'pass-1:attempt:1:sendEmail:7',
      attemptNumber: 1,
    }

    expect(await exec({ message: 'hello' }, context)).toEqual({
      jobId: context.deliveryId,
      created: true,
    })
    expect(
      await exec(
        { message: 'hello' },
        {
          ...context,
          attemptId: 'pass-1:attempt:2:sendEmail:7',
          attemptNumber: 2,
        },
      ),
    ).toEqual({ jobId: context.deliveryId, created: false })
    expect(await store.list()).toMatchObject([
      {
        id: context.deliveryId,
        requestedAt: new Date(context.scheduledAt),
      },
    ])
  })
})

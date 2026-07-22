import { describe, expect, it, vi } from 'vitest'
import { Effect } from 'effect'

import { createMemoryReactionOutboxStore } from './memory-store'
import { withReactionOutbox, type OutboxedReaction } from './plugin'
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

    expect((await Effect.runPromise(store.get('job-1')))?.payload).toBe(effect)
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
    expect(await Effect.runPromise(store.get('job-1'))).toMatchObject({
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
    expect(await Effect.runPromise(store.get('job-1'))).toMatchObject({
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
    expect(await Effect.runPromise(store.get('job-1'))).toMatchObject({
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
    expect(await Effect.runPromise(store.get('job-1'))).toMatchObject({
      status: 'completed',
    })
  })

  it('stops cleanly without claiming work when its lifecycle is aborted', async () => {
    const store = createMemoryReactionOutboxStore<{ message: string }>()
    await Effect.runPromise(
      store.enqueue({
        id: 'job-1',
        idempotencyKey: 'job-1',
        payload: { message: 'leave pending' },
        requestedAt: new Date(0),
        availableAt: new Date(0),
      }),
    )
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

    expect(await Effect.runPromise(store.get('job-1'))).toMatchObject({
      status: 'pending',
    })
  })

  it('waits for and reclaims a running job after its crash lease expires', async () => {
    const store = createMemoryReactionOutboxStore<{ message: string }>()
    await Effect.runPromise(
      store.enqueue({
        id: 'job-1',
        idempotencyKey: 'job-1',
        payload: { message: 'recover me' },
        requestedAt: new Date(0),
        availableAt: new Date(0),
      }),
    )
    await Effect.runPromise(store.claimNext(new Date(0), new Date(25)))
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
    expect(await Effect.runPromise(store.get('job-1'))).toMatchObject({
      status: 'completed',
      attemptCount: 2,
    })
  })

  it('rejects completion from a worker that lost its attempt lease', async () => {
    const store = createMemoryReactionOutboxStore<{ message: string }>()
    await Effect.runPromise(
      store.enqueue({
        id: 'job-1',
        idempotencyKey: 'job-1',
        payload: { message: 'work' },
        requestedAt: new Date(0),
        availableAt: new Date(0),
      }),
    )
    const first = await Effect.runPromise(
      store.claimNext(new Date(0), new Date(10)),
    )
    await Effect.runPromise(store.requeueExpired(new Date(10)))
    const second = await Effect.runPromise(
      store.claimNext(new Date(10), new Date(20)),
    )

    await expect(
      Effect.runPromise(
        store.complete(
          'job-1',
          first?.activeAttemptId ?? 'missing',
          new Date(11),
        ),
      ),
    ).rejects.toBeInstanceOf(ReactionOutboxLeaseLostError)
    await Effect.runPromise(
      store.complete(
        'job-1',
        second?.activeAttemptId ?? 'missing',
        new Date(12),
      ),
    )
    expect(await Effect.runPromise(store.get('job-1'))).toMatchObject({
      status: 'completed',
    })
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

describe('outbox Reaction Plugin', () => {
  it('deduplicates enqueue and runs wrapped Plugin outside caller Effect', async () => {
    const store =
      createMemoryReactionOutboxStore<OutboxedReaction<{ message: string }>>()
    const handled: string[] = []
    const plugin = withReactionOutbox(
      () =>
        Effect.succeed((output: { message: string }) =>
          Effect.sync(() => {
            handled.push(output.message)
          }),
        ),
      { store, pollIntervalMs: 1 },
    )
    const context = {
      deliveryId: 'sendEmail:7',
      throughOrder: 7,
      scheduledAt: '2026-07-16T00:00:00.000Z',
    }

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const exec = yield* plugin(() => Effect.void)
          yield* exec({ message: 'hello' }, context)
          yield* exec({ message: 'hello' }, context)
          yield* Effect.sleep('20 millis')
        }),
      ),
    )
    expect(handled).toEqual(['hello'])
    expect(await Effect.runPromise(store.list())).toMatchObject([
      {
        id: context.deliveryId,
        status: 'completed',
        requestedAt: new Date(context.scheduledAt),
      },
    ])
  })
})

import { describe, expect, it, vi } from 'vitest'
import type { ReactionPluginContext } from '@specter-ts/core'
import { Context, Effect } from 'effect'

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

describe('Reaction outbox worker wake-up and lease renewal', () => {
  const waitFor = async (condition: () => boolean, timeoutMs = 1_000) => {
    const started = Date.now()
    while (!condition()) {
      if (Date.now() - started > timeoutMs) throw new Error('timed out')
      await new Promise((resolve) => setTimeout(resolve, 2))
    }
  }

  it('starts work enqueued in the same process without waiting to poll', async () => {
    const store = createMemoryReactionOutboxStore<{ message: string }>()
    const handled: string[] = []
    const controller = new AbortController()
    const worker = createReactionOutboxWorker({
      store,
      signal: controller.signal,
      handle: async (payload) => {
        handled.push(payload.message)
      },
    })
    const running = runReactionOutboxWorker(worker, {
      signal: controller.signal,
      pollIntervalMs: 60_000,
    })
    await new Promise((resolve) => setTimeout(resolve, 5))

    await Effect.runPromise(
      store.enqueue({
        id: 'job-1',
        idempotencyKey: 'job-1',
        payload: { message: 'now' },
        requestedAt: new Date(),
        availableAt: new Date(),
      }),
    )
    await waitFor(() => handled.length === 1)
    controller.abort()
    await running

    expect(handled).toEqual(['now'])
  })

  it('ends a backoff wait early when new work arrives', async () => {
    const store = createMemoryReactionOutboxStore<{ message: string }>()
    const handled: string[] = []
    const controller = new AbortController()
    const worker = createReactionOutboxWorker({
      store,
      signal: controller.signal,
      handle: async (payload) => {
        handled.push(payload.message)
      },
    })
    await Effect.runPromise(
      store.enqueue({
        id: 'later',
        idempotencyKey: 'later',
        payload: { message: 'later' },
        requestedAt: new Date(),
        availableAt: new Date(Date.now() + 60_000),
      }),
    )
    const draining = worker.drain()
    await new Promise((resolve) => setTimeout(resolve, 5))

    await worker.enqueue({ message: 'now' }, { jobId: 'now' })
    await waitFor(() => handled.length === 1)
    controller.abort()
    await draining

    expect(handled).toEqual(['now'])
    expect(await Effect.runPromise(store.get('later'))).toMatchObject({
      status: 'pending',
    })
  })

  it('keeps one wake-up that arrives while a drain is busy', async () => {
    const store = createMemoryReactionOutboxStore<{ message: string }>()
    const worker = createReactionOutboxWorker({
      store,
      handle: async () => {},
    })
    await worker.enqueue({ message: 'wake' })
    const started = Date.now()

    await worker.waitForWork(60_000)
    expect(Date.now() - started).toBeLessThan(1_000)
  })

  it('renews the attempt lease while a slow handler runs', async () => {
    const store = createMemoryReactionOutboxStore<{ message: string }>()
    const expiredDuringAttempt: number[] = []
    const worker = createReactionOutboxWorker({
      store,
      leaseMs: 100,
      heartbeatMs: 10,
      idFactory: () => 'job-1',
      handle: async () => {
        for (let beat = 0; beat < 5; beat += 1) {
          await new Promise((resolve) => setTimeout(resolve, 50))
          expiredDuringAttempt.push(
            await Effect.runPromise(store.requeueExpired(new Date())),
          )
        }
      },
    })
    await worker.enqueue({ message: 'slow' })
    await worker.drain()

    expect(expiredDuringAttempt).toEqual([0, 0, 0, 0, 0])
    expect(await Effect.runPromise(store.get('job-1'))).toMatchObject({
      status: 'completed',
      attemptCount: 1,
    })
  })

  it('keeps the claimed lease when the Store cannot renew it', async () => {
    const memory = createMemoryReactionOutboxStore<{ message: string }>()
    const store = { ...memory, renewLease: undefined }
    const attempts: string[] = []
    const worker = createReactionOutboxWorker({
      store,
      leaseMs: 20,
      heartbeatMs: 5,
      idFactory: () => 'job-1',
      handle: async (_payload, context) => {
        attempts.push(context.attemptId)
        if (context.attemptNumber > 1) return
        await new Promise((resolve) => setTimeout(resolve, 40))
        await Effect.runPromise(store.requeueExpired(new Date()))
      },
    })
    await worker.enqueue({ message: 'slow' })
    await worker.drain()

    // The first attempt lost its lease while running and was claimed again.
    expect(attempts).toEqual(['job-1:attempt:1', 'job-1:attempt:2'])
  })

  it('rejects a heartbeat longer than the lease or a timer allows', () => {
    for (const [leaseMs, heartbeatMs] of [
      [10, 10],
      [10, 0],
      [Number.MAX_SAFE_INTEGER, 2_147_483_648],
    ]) {
      expect(() =>
        createReactionOutboxWorker({
          store: createMemoryReactionOutboxStore(),
          leaseMs,
          heartbeatMs,
          handle: async () => {},
        }),
      ).toThrow('heartbeatMs must be positive, shorter than leaseMs')
    }
    // A default heartbeat for a very long lease is capped, not rejected.
    createReactionOutboxWorker({
      store: createMemoryReactionOutboxStore(),
      leaseMs: Number.MAX_SAFE_INTEGER,
      handle: async () => {},
    }).close()
  })

  it('stops heartbeats after the lease is lost and reports it', async () => {
    const memory = createMemoryReactionOutboxStore<{ message: string }>()
    const renewals: string[] = []
    const store = {
      ...memory,
      renewLease: (jobId: string, attemptId: string, leaseExpiresAt: Date) => {
        renewals.push(attemptId)
        return memory.renewLease(jobId, attemptId, leaseExpiresAt)
      },
    }
    const transitions: string[] = []
    const worker = createReactionOutboxWorker({
      store,
      leaseMs: 1_000,
      heartbeatMs: 5,
      idFactory: () => 'job-1',
      onTransition: (transition) => {
        if (transition.type === 'lease-renewal-failed') {
          transitions.push(`${transition.type}:${transition.leaseLost}`)
        }
      },
      handle: async (_payload, context) => {
        if (context.attemptNumber > 1) return
        // Another worker takes the job over and finishes it while this
        // attempt still runs.
        const later = new Date(8.64e15)
        await Effect.runPromise(store.requeueExpired(later))
        const takeover = await Effect.runPromise(store.claimNext(later, later))
        await Effect.runPromise(
          store.complete('job-1', takeover?.activeAttemptId ?? '', later),
        )
        await new Promise((resolve) => setTimeout(resolve, 60))
      },
    })
    await worker.enqueue({ message: 'slow' })
    await worker.drain()

    expect(transitions).toEqual(['lease-renewal-failed:true'])
    expect(renewals.filter((id) => id === 'job-1:attempt:1')).toHaveLength(1)
  })

  it('reports other renewal failures and keeps renewing', async () => {
    const memory = createMemoryReactionOutboxStore<{ message: string }>()
    const store = {
      ...memory,
      renewLease: () => Effect.fail(new Error('disk unavailable')),
    }
    const errors: string[] = []
    const worker = createReactionOutboxWorker({
      store,
      leaseMs: 1_000,
      heartbeatMs: 5,
      onTransition: (transition) => {
        if (transition.type === 'lease-renewal-failed') {
          errors.push(transition.error)
        }
      },
      handle: async () => {
        await new Promise((resolve) => setTimeout(resolve, 60))
      },
    })
    await worker.enqueue({ message: 'slow' })
    await worker.drain()

    expect(errors.length).toBeGreaterThan(1)
    expect(new Set(errors)).toEqual(new Set(['disk unavailable']))
  })

  it('unsubscribes from the Store and stops its service on close', async () => {
    const memory = createMemoryReactionOutboxStore<{ message: string }>()
    let subscribed = 0
    const store = {
      ...memory,
      subscribe: (listener: () => void) => {
        subscribed += 1
        const unsubscribe = memory.subscribe(listener)
        return () => {
          subscribed -= 1
          unsubscribe()
        }
      },
    }
    const worker = createReactionOutboxWorker({ store, handle: async () => {} })
    expect(subscribed).toBe(1)
    const running = runReactionOutboxWorker(worker, { pollIntervalMs: 60_000 })
    await new Promise((resolve) => setTimeout(resolve, 5))

    worker.close()
    await running
    expect(subscribed).toBe(0)
    expect(worker.signal.aborted).toBe(true)
  })
})

describe('outbox Reaction Plugin', () => {
  it('deduplicates enqueue and runs wrapped Plugin outside caller Effect', async () => {
    const store =
      createMemoryReactionOutboxStore<OutboxedReaction<{ message: string }>>()
    const handled: string[] = []
    const callerMarker = Context.Reference<string>('outbox-test/CallerMarker', {
      defaultValue: () => 'worker',
    })
    const pluginContext: ReactionPluginContext = {
      command: () =>
        Effect.succeed({ events: [], version: 7, duplicate: false }),
      query: () => Effect.die('This Plugin does not run Queries.'),
    }
    let receivedContext: ReactionPluginContext | undefined
    const plugin = withReactionOutbox(
      (context) =>
        Effect.sync(() => {
          receivedContext = context
          return (output: { message: string }) =>
            Effect.gen(function* () {
              const marker = yield* callerMarker
              const receipt = yield* context.command({
                type: 'recordDelivery',
                payload: output.message,
              })
              handled.push(`${output.message}:${marker}:${receipt.version}`)
            })
        }),
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
          const exec = yield* plugin(pluginContext)
          yield* exec({ message: 'hello' }, context).pipe(
            Effect.provideService(callerMarker, 'caller'),
          )
          yield* exec({ message: 'hello' }, context)
          yield* Effect.sleep('20 millis')
        }),
      ),
    )
    expect(receivedContext).toBe(pluginContext)
    expect(handled).toEqual(['hello:worker:7'])
    expect(await Effect.runPromise(store.list())).toMatchObject([
      {
        id: context.deliveryId,
        status: 'completed',
        requestedAt: new Date(context.scheduledAt),
      },
    ])
  })

  it('starts an enqueued delivery without waiting for the poll interval', async () => {
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
      { store, pollIntervalMs: 60_000 },
    )

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const exec = yield* plugin(() => Effect.void)
          yield* Effect.sleep('5 millis')
          yield* exec(
            { message: 'hello' },
            {
              deliveryId: 'sendEmail:1',
              throughOrder: 1,
              scheduledAt: new Date().toISOString(),
            },
          )
          yield* Effect.sleep('30 millis')
        }),
      ),
    )
    expect(handled).toEqual(['hello'])
  })

  it('lets a running delivery record completion before its scope closes', async () => {
    const store =
      createMemoryReactionOutboxStore<OutboxedReaction<{ message: string }>>()
    const handled: string[] = []
    const plugin = withReactionOutbox(
      () =>
        Effect.succeed((output: { message: string }) =>
          Effect.promise(async () => {
            await new Promise((resolve) => setTimeout(resolve, 50))
            handled.push(output.message)
          }),
        ),
      { store },
    )

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const exec = yield* plugin(() => Effect.void)
          yield* exec(
            { message: 'hello' },
            {
              deliveryId: 'sendEmail:1',
              throughOrder: 1,
              scheduledAt: new Date().toISOString(),
            },
          )
          yield* Effect.sleep('10 millis')
        }),
      ),
    )

    expect(handled).toEqual(['hello'])
    expect(await Effect.runPromise(store.get('sendEmail:1'))).toMatchObject({
      status: 'completed',
    })
  })

  it('bounds the shutdown wait with shutdownTimeoutMs', async () => {
    const store =
      createMemoryReactionOutboxStore<OutboxedReaction<{ message: string }>>()
    const plugin = withReactionOutbox(
      () =>
        Effect.succeed(() =>
          Effect.promise(
            () => new Promise<void>((resolve) => setTimeout(resolve, 200)),
          ),
        ),
      { store, shutdownTimeoutMs: 5 },
    )
    const started = Date.now()

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const exec = yield* plugin(() => Effect.void)
          yield* exec(
            { message: 'slow' },
            {
              deliveryId: 'sendEmail:1',
              throughOrder: 1,
              scheduledAt: new Date().toISOString(),
            },
          )
          yield* Effect.sleep('10 millis')
        }),
      ),
    )

    expect(Date.now() - started).toBeLessThan(150)
    expect(await Effect.runPromise(store.get('sendEmail:1'))).toMatchObject({
      status: 'running',
    })
  })
})

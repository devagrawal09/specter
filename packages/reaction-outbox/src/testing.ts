import { AdapterConformanceFailure } from '@specter-ts/core/testing'
import { Cause, Effect, Exit } from 'effect'
import { describe, it } from 'vitest'

import { ReactionOutboxLeaseLostError } from './errors'
import type {
  EnqueueReactionInput,
  ReactionOutboxJob,
  ReactionOutboxStore,
} from './types'

/** The payload the conformance program enqueues. */
export type ReactionOutboxConformancePayload = { readonly value: string }

/**
 * Holds a Reaction outbox Store to the contract the worker relies on:
 * idempotent enqueue, claims in order of availability and request, attempts
 * that only their active attempt can settle, expired leases requeued, dead
 * letters retried, the next time work is due, and, when the Store declares
 * them, concurrency keys, lease renewal and in-process wake-ups. Each run
 * needs an empty Store. Payloads round-trip as JSON.
 */
export function reactionOutboxStoreConformance<TCreateError, TRequirements>(
  createStore: Effect.Effect<
    ReactionOutboxStore<ReactionOutboxConformancePayload>,
    TCreateError,
    TRequirements
  >,
) {
  return Effect.gen(function* () {
    const store = yield* createStore
    const job = (
      id: string,
      requested: number,
      available = requested,
      concurrencyKey?: string,
    ): EnqueueReactionInput<ReactionOutboxConformancePayload> => ({
      id,
      idempotencyKey: `key-${id}`,
      ...(concurrencyKey === undefined ? {} : { concurrencyKey }),
      payload: { value: id },
      requestedAt: at(requested),
      availableAt: at(available),
    })

    const first = yield* store.enqueue(job('a', 0))
    const repeated = yield* store.enqueue({
      ...job('a-again', 5),
      idempotencyKey: 'key-a',
      payload: { value: 'changed' },
    })
    yield* store.enqueue(job('b', 1, 50))
    yield* store.enqueue(job('c', 2, 0))
    yield* requireInvariant(
      'enqueue stores a pending job, and a known idempotency key returns its job',
      first.created &&
        first.job.status === 'pending' &&
        first.job.attemptCount === 0 &&
        first.job.payload.value === 'a' &&
        sameTime(first.job.requestedAt, at(0)) &&
        !repeated.created &&
        repeated.job.id === 'a' &&
        repeated.job.payload.value === 'a',
      { first, repeated },
    )
    const listed = yield* store.list()
    const pending = yield* store.list('pending')
    yield* requireInvariant(
      'list orders jobs by request time and filters by status',
      ids(listed) === 'a,b,c' && ids(pending) === 'a,b,c',
      { listed, pending },
    )
    yield* requireInvariant(
      'the next work is the earliest available pending job',
      sameTime(yield* store.nextWorkAt(), at(0)),
      undefined,
    )

    // Claims go in order of availability, then request time, then ID, and
    // never before a job is available.
    const lease = at(1_000)
    const claimA = yield* store.claimNext(at(10), lease)
    const claimC = yield* store.claimNext(at(10), lease)
    const none = yield* store.claimNext(at(10), lease)
    yield* requireInvariant(
      'claimNext claims the first available job as a running attempt',
      claimA?.id === 'a' &&
        claimA.status === 'running' &&
        claimA.attemptCount === 1 &&
        typeof claimA.activeAttemptId === 'string' &&
        sameTime(claimA.leaseExpiresAt, lease) &&
        claimC?.id === 'c' &&
        none === undefined,
      { claimA, claimC, none },
    )
    if (!claimA || !claimC) return
    const runningA = yield* store.get('a')
    yield* requireInvariant(
      'a claimed job is running under its attempt',
      runningA?.status === 'running' &&
        runningA.activeAttemptId === claimA.activeAttemptId,
      runningA,
    )
    yield* requireInvariant(
      'the next work is the earliest pending availability or running lease',
      sameTime(yield* store.nextWorkAt(), at(50)),
      undefined,
    )

    const wrongAttempt = yield* failureOf(
      store.complete('a', `${claimA.activeAttemptId}-stale`, at(20)),
    )
    yield* store.complete('a', claimA.activeAttemptId, at(20))
    const completed = yield* store.get('a')
    const completedAgain = yield* failureOf(
      store.complete('a', claimA.activeAttemptId, at(21)),
    )
    yield* requireInvariant(
      'only the active attempt completes its job',
      wrongAttempt instanceof ReactionOutboxLeaseLostError &&
        completedAgain instanceof ReactionOutboxLeaseLostError &&
        completed?.status === 'completed' &&
        sameTime(completed.completedAt, at(20)) &&
        completed.activeAttemptId === undefined,
      { wrongAttempt, completed, completedAgain },
    )

    yield* store.reschedule('c', claimC.activeAttemptId, at(100), 'boom')
    const rescheduled = yield* store.get('c')
    const lateCompletion = yield* failureOf(
      store.complete('c', claimC.activeAttemptId, at(30)),
    )
    const claimB = yield* store.claimNext(at(60), at(1_060))
    const claimC2 = yield* store.claimNext(at(100), at(1_100))
    yield* requireInvariant(
      'a rescheduled job waits until it is available, and runs again under a new attempt',
      rescheduled?.status === 'pending' &&
        sameTime(rescheduled.availableAt, at(100)) &&
        rescheduled.lastError === 'boom' &&
        lateCompletion instanceof ReactionOutboxLeaseLostError &&
        claimB?.id === 'b' &&
        claimC2?.id === 'c' &&
        claimC2.attemptCount === 2 &&
        claimC2.activeAttemptId !== claimC.activeAttemptId,
      { rescheduled, lateCompletion, claimB, claimC2 },
    )
    if (!claimB || !claimC2) return

    const notExpired = yield* store.requeueExpired(at(1_059))
    const expired = yield* store.requeueExpired(at(1_060))
    const requeued = yield* store.get('b')
    const expiredCompletion = yield* failureOf(
      store.complete('b', claimB.activeAttemptId, at(1_061)),
    )
    yield* requireInvariant(
      'requeueExpired returns jobs whose lease ran out to pending',
      notExpired === 0 &&
        expired === 1 &&
        requeued?.status === 'pending' &&
        requeued.activeAttemptId === undefined &&
        typeof requeued.lastError === 'string' &&
        expiredCompletion instanceof ReactionOutboxLeaseLostError,
      { notExpired, expired, requeued, expiredCompletion },
    )

    yield* store.deadLetter('c', claimC2.activeAttemptId, at(200), 'gave up')
    const dead = yield* store.get('c')
    const deadLetters = yield* store.list('dead-letter')
    const notDead = yield* failureOf(store.retryDeadLetter('a', at(300)))
    yield* store.retryDeadLetter('c', at(300))
    const retried = yield* store.get('c')
    yield* requireInvariant(
      'a dead-lettered job stays until it is retried',
      dead?.status === 'dead-letter' &&
        dead.lastError === 'gave up' &&
        ids(deadLetters) === 'c' &&
        notDead !== undefined &&
        retried?.status === 'pending' &&
        sameTime(retried.availableAt, at(300)),
      { dead, deadLetters, notDead, retried },
    )

    // Settle what is left, so the optional parts start from no work.
    for (const now of [at(1_100), at(1_100)]) {
      const claim = yield* store.claimNext(now, at(5_000))
      if (claim) yield* store.complete(claim.id, claim.activeAttemptId, now)
    }
    const remaining = yield* store.list('pending')
    yield* requireInvariant(
      'every job runs to completion',
      remaining.length === 0 && (yield* store.nextWorkAt()) === undefined,
      remaining,
    )

    if (store.renewLease) {
      yield* store.enqueue(job('renewed', 2_000))
      const claim = yield* store.claimNext(at(2_000), at(2_100))
      if (!claim) return yield* fail('a job to renew', claim)
      yield* store.renewLease(claim.id, claim.activeAttemptId, at(3_000))
      const kept = yield* store.requeueExpired(at(2_500))
      const renewed = yield* store.get('renewed')
      const stale = yield* failureOf(
        store.renewLease(claim.id, `${claim.activeAttemptId}-stale`, at(4_000)),
      )
      yield* store.complete(claim.id, claim.activeAttemptId, at(2_600))
      yield* requireInvariant(
        'renewLease moves an active attempt’s lease, and only the active attempt’s',
        kept === 0 &&
          sameTime(renewed?.leaseExpiresAt, at(3_000)) &&
          stale instanceof ReactionOutboxLeaseLostError,
        { kept, renewed, stale },
      )
    }

    if (store.concurrencyKeys) {
      yield* store.enqueue(job('k1', 4_000, 4_000, 'k'))
      yield* store.enqueue(job('k2', 4_001, 4_000, 'k'))
      yield* store.enqueue(job('free', 4_002, 4_000))
      const k1 = yield* store.claimNext(at(4_100), at(9_000))
      const free = yield* store.claimNext(at(4_100), at(8_000))
      const blocked = yield* store.claimNext(at(4_100), at(9_000))
      const blockedWork = yield* store.nextWorkAt()
      if (!k1 || !free) return yield* fail('jobs with keys to claim', k1)
      yield* store.complete(k1.id, k1.activeAttemptId, at(4_200))
      const k2 = yield* store.claimNext(at(4_200), at(9_000))
      const keyed = yield* store.get('k2')
      yield* requireInvariant(
        'a job never runs while another job with its concurrency key runs',
        k1.id === 'k1' &&
          k1.concurrencyKey === 'k' &&
          free.id === 'free' &&
          blocked === undefined &&
          sameTime(blockedWork, at(8_000)) &&
          k2?.id === 'k2' &&
          keyed?.concurrencyKey === 'k',
        { k1, free, blocked, blockedWork, k2 },
      )
      for (const claim of [free, k2]) {
        if (claim)
          yield* store.complete(claim.id, claim.activeAttemptId, at(4_300))
      }
    }

    if (store.subscribe) {
      let wakes = 0
      const unsubscribe = store.subscribe(() => {
        wakes += 1
      })
      yield* store.enqueue(job('woken', 6_000))
      const afterEnqueue = wakes
      yield* store.enqueue({
        ...job('woken-again', 6_001),
        idempotencyKey: 'key-woken',
      })
      const afterDuplicate = wakes
      unsubscribe()
      yield* store.enqueue(job('unheard', 6_002))
      yield* requireInvariant(
        'subscribe wakes a listener when an enqueue creates work, until it unsubscribes',
        afterEnqueue === 1 && afterDuplicate === 1 && wakes === 1,
        { afterEnqueue, afterDuplicate, wakes },
      )
    }
  })
}

/** Thin Vitest runner. Semantics live in the Effect program above. */
export function testReactionOutboxStore(
  name: string,
  createStore: () =>
    | ReactionOutboxStore<ReactionOutboxConformancePayload>
    | Promise<ReactionOutboxStore<ReactionOutboxConformancePayload>>,
) {
  describe(`${name} Reaction outbox Store`, () => {
    it('conforms', async () => {
      await Effect.runPromise(
        reactionOutboxStoreConformance(
          Effect.promise(() => Promise.resolve(createStore())),
        ),
      )
    })
  })
}

/**
 * What an operation failed with, whether a Store fails its Effect or throws
 * inside it: the worker sees both as the same rejection.
 */
function failureOf<A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<unknown, never, R> {
  return Effect.map(Effect.exit(effect), (exit) =>
    Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined,
  )
}

const base = Date.UTC(2026, 0, 1)

function at(ms: number) {
  return new Date(base + ms)
}

function sameTime(actual: Date | undefined, expected: Date) {
  return actual instanceof Date && actual.getTime() === expected.getTime()
}

function ids(jobs: readonly ReactionOutboxJob<unknown>[]) {
  return jobs.map((job) => job.id).join(',')
}

function requireInvariant(
  invariant: string,
  condition: boolean,
  actual: unknown,
) {
  return condition ? Effect.void : fail(invariant, actual)
}

function fail(invariant: string, actual: unknown) {
  return Effect.fail(
    new AdapterConformanceFailure('reaction-outbox-store', invariant, actual),
  )
}

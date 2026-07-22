import {
  ReactionScheduler,
  ReactionSchedulerFailure,
  type ReactionDeliveryContext,
  type ReactionSchedulerService,
} from '@specter-ts/core'
import { Effect, Fiber, Layer, Semaphore, type Scope } from 'effect'

import type { ReactionOutboxStore } from './types'

export type DurableReactionSchedulerOptions = {
  readonly now?: () => Date
  readonly leaseMs?: number
}

export type ReactionPass = {
  readonly throughOrder: number
}

export function createDurableReactionSchedulerService(
  store: ReactionOutboxStore<ReactionPass>,
  scope: Scope.Scope,
  options: DurableReactionSchedulerOptions = {},
): ReactionSchedulerService {
  const now = options.now ?? (() => new Date())
  const leaseMs = options.leaseMs ?? 5 * 60_000
  const semaphore = Semaphore.makeUnsafe(1)
  const active = new Map<number, Fiber.Fiber<void, ReactionSchedulerFailure>>()

  function contextFor(
    claim: Awaited<ReturnType<typeof store.claimNext>> & {},
  ): ReactionDeliveryContext {
    return {
      deliveryId: claim.id,
      throughOrder: claim.payload.throughOrder,
      scheduledAt: claim.requestedAt.toISOString(),
      attemptId: claim.activeAttemptId,
      attemptNumber: claim.attemptCount,
    }
  }

  function drainOne<E>(
    execute: (context: ReactionDeliveryContext) => Effect.Effect<void, E>,
  ) {
    return semaphore.withPermit(
      Effect.gen(function* () {
        const claimTime = now()
        yield* Effect.tryPromise(() => store.requeueExpired(claimTime))
        const claim = yield* Effect.tryPromise(() =>
          store.claimNext(claimTime, new Date(claimTime.getTime() + leaseMs)),
        )
        if (!claim) return false
        const result = yield* Effect.result(execute(contextFor(claim)))
        if (result._tag === 'Failure') {
          yield* Effect.tryPromise(() =>
            store.reschedule(
              claim.id,
              claim.activeAttemptId,
              now(),
              String(result.failure),
            ),
          )
          return yield* Effect.fail(result.failure)
        }
        yield* Effect.tryPromise(() =>
          store.complete(claim.id, claim.activeAttemptId, now()),
        )
        return true
      }),
    )
  }

  function drainAll<E>(
    execute: (context: ReactionDeliveryContext) => Effect.Effect<void, E>,
  ) {
    return Effect.gen(function* () {
      for (;;) {
        if (!(yield* drainOne(execute))) return
      }
    })
  }

  return {
    schedule: (throughOrder, execute) =>
      Effect.gen(function* () {
        const running = active.get(throughOrder)
        if (running) return Fiber.join(running)
        const requestedAt = now()
        yield* Effect.tryPromise({
          try: () =>
            store.enqueue({
              id: `reaction-through-${throughOrder}`,
              idempotencyKey: `reaction-through-${throughOrder}`,
              payload: { throughOrder },
              requestedAt,
              availableAt: requestedAt,
            }),
          catch: (cause) => new ReactionSchedulerFailure('schedule', cause),
        })
        const fiber = yield* Effect.forkIn(
          drainAll(execute).pipe(
            Effect.mapError(
              (cause) => new ReactionSchedulerFailure('schedule', cause),
            ),
            Effect.ensuring(
              Effect.sync(() => {
                active.delete(throughOrder)
              }),
            ),
          ),
          scope,
        )
        active.set(throughOrder, fiber)
        return Fiber.join(fiber)
      }),
    recover: (execute) =>
      drainAll(execute).pipe(
        Effect.mapError(
          (cause) => new ReactionSchedulerFailure('recover', cause),
        ),
      ),
  }
}

export function createDurableReactionSchedulerLayer(
  store: ReactionOutboxStore<ReactionPass>,
  options: DurableReactionSchedulerOptions = {},
): Layer.Layer<ReactionScheduler> {
  return Layer.effect(
    ReactionScheduler,
    Effect.gen(function* () {
      const scope = yield* Effect.scope
      return createDurableReactionSchedulerService(store, scope, options)
    }),
  )
}

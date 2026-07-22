import {
  ReactionScheduler,
  ReactionSchedulerFailure,
  type ReactionScheduleContext,
  type ReactionSchedulerService,
} from '@specter-ts/core'
import { Effect, Fiber, Layer, Semaphore, type Scope } from 'effect'

import type { ReactionOutboxStore } from './types'

export type DurableReactionSchedulerOptions = {
  readonly now?: () => Date
  readonly leaseMs?: number
  readonly waitIntervalMs?: number
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
  const waitIntervalMs = options.waitIntervalMs ?? 25
  const semaphore = Semaphore.makeUnsafe(1)

  function contextFor(
    throughOrder: number,
    scheduledAt: Date,
  ): ReactionScheduleContext {
    return {
      throughOrder,
      scheduledAt: scheduledAt.toISOString(),
    }
  }

  function drainOne<E>(
    execute: (
      context: ReactionScheduleContext,
    ) => Effect.Effect<void, E>,
  ): Effect.Effect<boolean, E | ReactionSchedulerFailure> {
    return semaphore.withPermit(
      Effect.gen(function* () {
        const claimTime = now()
        yield* store.requeueExpired(claimTime).pipe(
          Effect.mapError(
            (cause) => new ReactionSchedulerFailure('recover', cause),
          ),
        )
        const claim = yield* store
          .claimNext(
            claimTime,
            new Date(claimTime.getTime() + leaseMs),
          )
          .pipe(
            Effect.mapError(
              (cause) => new ReactionSchedulerFailure('recover', cause),
            ),
          )
        if (!claim) return false
        const result = yield* Effect.result(
          execute(contextFor(claim.payload.throughOrder, claim.requestedAt)),
        )
        if (result._tag === 'Failure') {
          yield* store
            .reschedule(
              claim.id,
              claim.activeAttemptId,
              now(),
              String(result.failure),
            )
            .pipe(
              Effect.mapError(
                (cause) => new ReactionSchedulerFailure('recover', cause),
              ),
            )
          return yield* Effect.fail(result.failure)
        }
        yield* store
          .complete(claim.id, claim.activeAttemptId, now())
          .pipe(
            Effect.mapError(
              (cause) => new ReactionSchedulerFailure('recover', cause),
            ),
          )
        return true
      }),
    )
  }

  function drainAll<E>(
    execute: (
      context: ReactionScheduleContext,
    ) => Effect.Effect<void, E>,
  ): Effect.Effect<void, E | ReactionSchedulerFailure> {
    return Effect.gen(function* () {
      while (yield* drainOne(execute)) {
        // Drain every claim currently visible to this runtime instance.
      }
    })
  }

  function waitFor(jobId: string): Effect.Effect<void, ReactionSchedulerFailure> {
    return Effect.gen(function* () {
      for (;;) {
        const job = yield* store.get(jobId).pipe(
          Effect.mapError(
            (cause) => new ReactionSchedulerFailure('wait', cause),
          ),
        )
        if (!job) {
          return yield* Effect.fail(
            new ReactionSchedulerFailure(
              'wait',
              new Error(`Unknown Reaction scheduler delivery: ${jobId}`),
            ),
          )
        }
        if (job.status === 'completed') return
        if (job.status === 'dead-letter') {
          return yield* Effect.fail(
            new ReactionSchedulerFailure('wait', job.lastError),
          )
        }
        yield* Effect.sleep(`${waitIntervalMs} millis`)
      }
    })
  }

  return {
    schedule: (throughOrder, execute) =>
      Effect.gen(function* () {
        const jobId = `reaction-through-${throughOrder}`
        const requestedAt = now()
        yield* store
          .enqueue({
            id: jobId,
            idempotencyKey: jobId,
            payload: { throughOrder },
            requestedAt,
            availableAt: requestedAt,
          })
          .pipe(
            Effect.mapError(
              (cause) => new ReactionSchedulerFailure('schedule', cause),
            ),
          )
        const fiber = yield* Effect.forkIn(drainAll(execute), scope)
        return Fiber.join(fiber).pipe(Effect.flatMap(() => waitFor(jobId)))
      }),
    recover: (execute) => drainAll(execute),
  }
}

export function createDurableReactionSchedulerLayer(
  store: ReactionOutboxStore<ReactionPass>,
  options: DurableReactionSchedulerOptions = {},
): Layer.Layer<never> {
  return Layer.effect(
    ReactionScheduler,
    Effect.gen(function* () {
      const scope = yield* Effect.scope
      return createDurableReactionSchedulerService(store, scope, options)
    }),
  )
}

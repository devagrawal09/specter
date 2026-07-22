import { Clock, Context, Effect, Fiber, Semaphore } from 'effect'

export type ReactionScheduleContext = {
  readonly throughOrder: number
  readonly scheduledAt: string
}

export class ReactionSchedulerFailure extends Error {
  readonly _tag = 'ReactionSchedulerFailure' as const

  constructor(
    readonly operation: 'bind' | 'request' | 'wait' | 'reconcile',
    readonly cause: unknown,
  ) {
    super(`Reaction scheduler ${operation} failed.`, { cause })
    this.name = 'ReactionSchedulerFailure'
  }
}

export type ReactionExecutor<E> = (
  context: ReactionScheduleContext,
) => Effect.Effect<void, E>

export type ReactionSchedulerBinding<E> = {
  readonly execute: ReactionExecutor<E>
  readonly reconcile: Effect.Effect<void, E>
}

export type BoundReactionScheduler<E> = {
  readonly request: (
    throughOrder: number,
  ) => Effect.Effect<void, ReactionSchedulerFailure>
  readonly await: (
    throughOrder: number,
  ) => Effect.Effect<void, E | ReactionSchedulerFailure>
}

/**
 * Event Log commits and Reaction Slice cursors remain canonical. Scheduler
 * state is a rebuildable coordination index. `bind` attaches one executor for
 * the application lifetime and reconciles from Event Log plus Slice cursors.
 * `request` accepts a commit boundary; `await` observes its completion.
 */
export type ReactionSchedulerService = {
  readonly bind: <E>(
    binding: ReactionSchedulerBinding<E>,
  ) => Effect.Effect<BoundReactionScheduler<E>, E | ReactionSchedulerFailure>
}

export const ReactionScheduler = Context.Reference<ReactionSchedulerService>(
  '@specter-ts/core/ReactionScheduler',
  {
    defaultValue: () => ({
      bind: ({ execute, reconcile }) =>
        Effect.gen(function* () {
          const semaphore = Semaphore.makeUnsafe(1)
          yield* reconcile
          const active = new Map<number, Fiber.Fiber<void, any>>()
          const request = (throughOrder: number) =>
            Effect.gen(function* () {
              if (active.has(throughOrder)) return
              const scheduledAt = new Date(
                yield* Clock.currentTimeMillis,
              ).toISOString()
              const fiber = yield* Effect.forkDetach(
                semaphore.withPermit(execute({ throughOrder, scheduledAt })),
                { startImmediately: true },
              )
              active.set(throughOrder, fiber)
            })
          return {
            request,
            await: (throughOrder: number) =>
              Effect.gen(function* () {
                yield* request(throughOrder)
                const fiber = active.get(throughOrder)
                if (fiber) yield* Fiber.join(fiber)
              }),
          }
        }),
    }),
  },
)

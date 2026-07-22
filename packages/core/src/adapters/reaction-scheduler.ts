import { Clock, Context, Effect, Semaphore, type Scope } from 'effect'

export type ReactionScheduleContext = {
  readonly throughOrder: number
  readonly scheduledAt: string
}

export class ReactionSchedulerFailure extends Error {
  readonly _tag = 'ReactionSchedulerFailure' as const

  constructor(
    readonly operation: 'bind' | 'schedule' | 'run',
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
}

export type BoundReactionScheduler<E> = {
  readonly schedule: (
    throughOrder: number,
  ) => Effect.Effect<
    Effect.Effect<void, E | ReactionSchedulerFailure>,
    ReactionSchedulerFailure
  >
}

/**
 * Event Log commits and Reaction Slice cursors remain canonical. Scheduler
 * state is a rebuildable coordination index. `bind` attaches one executor for
 * the application lifetime. `schedule` acknowledges adapter acceptance before
 * returning a separate completion Effect. Core routes startup reconciliation
 * and new commit boundaries through that path, owns the scoped completion
 * fiber, and exposes completion separately from Command commit.
 */
export type ReactionSchedulerService = {
  readonly bind: <E>(
    binding: ReactionSchedulerBinding<E>,
  ) => Effect.Effect<
    BoundReactionScheduler<E>,
    E | ReactionSchedulerFailure,
    Scope.Scope
  >
}

export const ReactionScheduler = Context.Reference<ReactionSchedulerService>(
  '@specter-ts/core/ReactionScheduler',
  {
    defaultValue: () => ({
      bind: ({ execute }) => {
        const semaphore = Semaphore.makeUnsafe(1)
        return Effect.succeed({
          schedule: (throughOrder: number) =>
            Effect.gen(function* () {
              const scheduledAt = new Date(
                yield* Clock.currentTimeMillis,
              ).toISOString()
              return semaphore.withPermit(
                execute({ throughOrder, scheduledAt }),
              )
            }),
        })
      },
    }),
  },
)

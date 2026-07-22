import { Clock, Context, Effect, Fiber, Semaphore } from 'effect'

export type ReactionScheduleContext = {
  readonly throughOrder: number
  readonly scheduledAt: string
}

export class ReactionSchedulerFailure extends Error {
  readonly _tag = 'ReactionSchedulerFailure' as const

  constructor(
    readonly operation: 'schedule' | 'recover' | 'wait',
    readonly cause: unknown,
  ) {
    super(`Reaction scheduler ${operation} failed.`, { cause })
    this.name = 'ReactionSchedulerFailure'
  }
}

export type ReactionExecutor<E> = (
  context: ReactionScheduleContext,
) => Effect.Effect<void, E>

/**
 * Event Log commits and Reaction Slice cursors remain canonical. Scheduler
 * state is a rebuildable coordination index. `schedule` durably accepts a
 * commit boundary before returning and exposes a completion Effect. `recover`
 * attaches a local executor and drains work accepted by any runtime instance.
 */
export type ReactionSchedulerService = {
  readonly schedule: <E>(
    throughOrder: number,
    execute: ReactionExecutor<E>,
  ) => Effect.Effect<
    Effect.Effect<void, E | ReactionSchedulerFailure>,
    ReactionSchedulerFailure
  >
  readonly recover: <E>(
    execute: ReactionExecutor<E>,
  ) => Effect.Effect<void, E | ReactionSchedulerFailure>
}

export const ReactionScheduler = Context.Reference<ReactionSchedulerService>(
  '@specter-ts/core/ReactionScheduler',
  {
    defaultValue: () => {
      const semaphore = Semaphore.makeUnsafe(1)
      return {
        schedule: (throughOrder, execute) =>
          Effect.gen(function* () {
            const scheduledAt = new Date(
              yield* Clock.currentTimeMillis,
            ).toISOString()
            const fiber = yield* Effect.forkDetach(
              semaphore.withPermit(execute({ throughOrder, scheduledAt })),
              { startImmediately: true },
            )
            return Fiber.join(fiber)
          }),
        recover: () => Effect.void,
      }
    },
  },
)

import { Context, type Effect } from 'effect'

export type ReactionDeliveryContext = {
  /** Stable across every retry of one durable delivery. */
  readonly deliveryId: string
  readonly throughOrder: number
  readonly scheduledAt: string
  readonly attemptId: string
  readonly attemptNumber: number
}

export class ReactionSchedulerFailure extends Error {
  readonly _tag = 'ReactionSchedulerFailure' as const

  constructor(
    readonly operation: 'schedule' | 'recover',
    readonly cause: unknown,
  ) {
    super(`Reaction scheduler ${operation} failed.`, { cause })
    this.name = 'ReactionSchedulerFailure'
  }
}

export type ReactionExecutor<E> = (
  context: ReactionDeliveryContext,
) => Effect.Effect<void, E>

/**
 * Native scheduler capability. `schedule` durably accepts work before it
 * returns; returned Effect waits for that delivery. `recover` drains accepted
 * work left incomplete by an earlier runtime.
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

export class ReactionScheduler extends Context.Service<
  ReactionScheduler,
  ReactionSchedulerService
>()('@specter-ts/core/ReactionScheduler') {}

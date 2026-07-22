import {
  ReactionScheduler,
  type ReactionSchedulerService,
} from '@specter-ts/core'
import { Effect, Fiber, Layer, Semaphore, type Scope } from 'effect'

export type ImmediateReactionSchedulerOptions = {
  readonly now?: () => Date
}

export function createImmediateReactionSchedulerService(
  scope: Scope.Scope,
  options: ImmediateReactionSchedulerOptions = {},
): ReactionSchedulerService {
  const now = options.now ?? (() => new Date())
  const semaphore = Semaphore.makeUnsafe(1)

  return {
    schedule: (throughOrder, execute) =>
      Effect.gen(function* () {
        const fiber = yield* Effect.forkIn(
          semaphore.withPermit(
            execute({
              throughOrder,
              scheduledAt: now().toISOString(),
            }),
          ),
          scope,
        )
        return Fiber.join(fiber)
      }),
    recover: () => Effect.void,
  }
}

export function createImmediateReactionSchedulerLayer(
  options: ImmediateReactionSchedulerOptions = {},
): Layer.Layer<never> {
  return Layer.effect(
    ReactionScheduler,
    Effect.gen(function* () {
      const scope = yield* Effect.scope
      return createImmediateReactionSchedulerService(scope, options)
    }),
  )
}

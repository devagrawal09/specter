import {
  ReactionScheduler,
  type ReactionSchedulerService,
} from '@specter-ts/core'
import { Effect, Fiber, Layer, Semaphore, type Scope } from 'effect'

export type ImmediateReactionSchedulerOptions = {
  readonly deliveryId?: (sequence: number) => string
  readonly now?: () => Date
}

export function createImmediateReactionSchedulerService(
  scope: Scope.Scope,
  options: ImmediateReactionSchedulerOptions = {},
): ReactionSchedulerService {
  const deliveryId =
    options.deliveryId ?? ((sequence) => `memory-reaction-pass-${sequence}`)
  const now = options.now ?? (() => new Date())
  let sequence = 0
  const semaphore = Semaphore.makeUnsafe(1)

  return {
    schedule: (throughOrder, execute) =>
      Effect.gen(function* () {
        sequence += 1
        const id = deliveryId(sequence)
        const fiber = yield* Effect.forkIn(
          semaphore.withPermit(
            execute({
              deliveryId: id,
              throughOrder,
              scheduledAt: now().toISOString(),
              attemptId: `${id}:attempt:1`,
              attemptNumber: 1,
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
): Layer.Layer<ReactionScheduler> {
  return Layer.effect(
    ReactionScheduler,
    Effect.gen(function* () {
      const scope = yield* Effect.scope
      return createImmediateReactionSchedulerService(scope, options)
    }),
  )
}

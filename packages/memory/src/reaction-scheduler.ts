import {
  ReactionScheduler,
  type ReactionSchedulerService,
} from '@specter-ts/core'
import { Effect, Layer, Semaphore } from 'effect'

export type ImmediateReactionSchedulerOptions = {
  readonly now?: () => Date
}

export function createImmediateReactionSchedulerService(
  options: ImmediateReactionSchedulerOptions = {},
): ReactionSchedulerService {
  const now = options.now ?? (() => new Date())
  const semaphore = Semaphore.makeUnsafe(1)

  return {
    bind: ({ execute }) =>
      Effect.succeed({
        schedule: (throughOrder: number) =>
          Effect.succeed(
            semaphore.withPermit(
              execute({
                throughOrder,
                scheduledAt: now().toISOString(),
              }),
            ),
          ),
      }),
  }
}

export function createImmediateReactionSchedulerLayer(
  options: ImmediateReactionSchedulerOptions = {},
): Layer.Layer<never> {
  return Layer.effect(
    ReactionScheduler,
    Effect.succeed(createImmediateReactionSchedulerService(options)),
  )
}

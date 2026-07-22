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
    bind: ({ execute, reconcile }) =>
      Effect.gen(function* () {
        yield* reconcile
        const active = new Map<number, Fiber.Fiber<void, any>>()
        const request = (throughOrder: number) =>
          Effect.gen(function* () {
            if (active.has(throughOrder)) return
            const fiber = yield* Effect.forkIn(
              semaphore.withPermit(
                execute({
                  throughOrder,
                  scheduledAt: now().toISOString(),
                }),
              ),
              scope,
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

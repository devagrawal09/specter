import type { ReactionDeliveryContext, ReactionPlugin } from '@specter-ts/core'
import { Effect } from 'effect'

import type { ReactionOutboxStore } from './types'
import {
  createReactionOutboxWorker,
  runReactionOutboxWorker,
  type ReactionOutboxWorkerOptions,
} from './worker'

export type OutboxedReaction<TOutput> = {
  readonly output: TOutput
  readonly context: ReactionDeliveryContext
}

export type ReactionOutboxPluginOptions<TOutput> = {
  readonly store: ReactionOutboxStore<OutboxedReaction<TOutput>>
  readonly worker?: Omit<
    ReactionOutboxWorkerOptions<OutboxedReaction<TOutput>>,
    'store' | 'handle' | 'signal'
  >
  readonly pollIntervalMs?: number
  readonly onError?: (cause: unknown) => Promise<void> | void
}

/**
 * Wraps any Reaction Plugin with durable enqueue. Slice processing waits only
 * for enqueue; a scoped worker executes the original Plugin outside the Slice
 * transaction and resumes unfinished deliveries after restart.
 */
export function withReactionOutbox<TOutput>(
  plugin: ReactionPlugin<TOutput>,
  options: ReactionOutboxPluginOptions<TOutput>,
): ReactionPlugin<TOutput> {
  return (command) =>
    Effect.gen(function* () {
      const execute = yield* plugin(command)
      const scope = yield* Effect.scope
      const controller = new AbortController()
      const worker = createReactionOutboxWorker({
        ...options.worker,
        store: options.store,
        signal: controller.signal,
        handle: (delivery) =>
          Effect.runPromise(execute(delivery.output, delivery.context)),
      })

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          controller.abort()
        }),
      )
      yield* Effect.forkIn(
        Effect.tryPromise({
          try: () =>
            runReactionOutboxWorker(worker, {
              signal: controller.signal,
              pollIntervalMs: options.pollIntervalMs,
              onError: options.onError ?? (() => {}),
            }),
          catch: (cause) => cause,
        }),
        scope,
      )

      return (output: TOutput, context: ReactionDeliveryContext) =>
        Effect.gen(function* () {
          const requestedAt = new Date(context.scheduledAt)
          if (Number.isNaN(requestedAt.getTime())) {
            throw new Error('Reaction scheduledAt must be ISO-8601')
          }
          yield* options.store.enqueue({
            id: context.deliveryId,
            idempotencyKey: context.deliveryId,
            payload: { output, context },
            requestedAt,
            availableAt: requestedAt,
          })
        })
    })
}

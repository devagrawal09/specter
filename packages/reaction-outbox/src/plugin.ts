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
  /**
   * When the Plugin's scope closes, the worker stops claiming and the
   * finalizer waits up to this long for a running attempt to finish and
   * record its outcome, so closing the Store afterwards does not make the job
   * run again. Defaults to 30 seconds.
   */
  readonly shutdownTimeoutMs?: number
  readonly onError?: (cause: unknown) => Promise<void> | void
}

/**
 * Wraps any Reaction Plugin with durable enqueue. Slice processing waits only
 * for enqueue; a scoped worker executes the original Plugin outside the Slice
 * transaction and resumes unfinished deliveries after restart. The wrapped
 * Plugin receives the same context, and may run Queries from the worker.
 */
export function withReactionOutbox<TOutput, R = never>(
  plugin: ReactionPlugin<TOutput, R>,
  options: ReactionOutboxPluginOptions<TOutput>,
): ReactionPlugin<TOutput, R> {
  return (context) =>
    Effect.gen(function* () {
      const execute = yield* plugin(context)
      const shutdownTimeoutMs = options.shutdownTimeoutMs ?? 30_000
      if (!Number.isFinite(shutdownTimeoutMs) || shutdownTimeoutMs < 0) {
        throw new Error('shutdownTimeoutMs must be non-negative')
      }
      const controller = new AbortController()
      const worker = createReactionOutboxWorker({
        ...options.worker,
        store: options.store,
        signal: controller.signal,
        handle: (delivery) =>
          Effect.runPromise(execute(delivery.output, delivery.context)),
      })

      const running = runReactionOutboxWorker(worker, {
        signal: controller.signal,
        pollIntervalMs: options.pollIntervalMs,
        onError: options.onError ?? (() => {}),
      }).catch(() => {
        // `onError` already saw every drain failure.
      })

      yield* Effect.addFinalizer(() =>
        Effect.promise(async () => {
          controller.abort()
          let timeout: ReturnType<typeof setTimeout> | undefined
          await Promise.race([
            running,
            new Promise<void>((resolve) => {
              timeout = setTimeout(resolve, shutdownTimeoutMs)
            }),
          ])
          clearTimeout(timeout)
        }),
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

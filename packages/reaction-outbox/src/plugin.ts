import type { ReactionDeliveryContext, ReactionPlugin } from '@specter-ts/core'

import type { ReactionOutboxStore } from './types'

export type OutboxReactionPluginOptions<TEffect, TPayload = TEffect> = {
  readonly store: ReactionOutboxStore<TPayload>
  readonly map?: (
    effect: TEffect,
    context: ReactionDeliveryContext,
  ) => Promise<TPayload> | TPayload
}

/**
 * Creates a Reaction Plugin that durably enqueues an effect instead of
 * performing external I/O inline. The core-provided delivery ID is stable for
 * the Reaction and Event cursor, so a retry after a crash deduplicates the
 * already-enqueued effect before the cursor is published.
 */
export function createOutboxReactionPlugin<TEffect, TPayload = TEffect>(
  options: OutboxReactionPluginOptions<TEffect, TPayload>,
): ReactionPlugin<TEffect> {
  return async () => async (effect, context) => {
    const requestedAt = new Date(context.scheduledAt)
    if (Number.isNaN(requestedAt.getTime())) {
      throw new Error('Reaction delivery scheduledAt must be ISO-8601')
    }
    const payload = options.map
      ? await options.map(effect, context)
      : (effect as unknown as TPayload)
    const result = await options.store.enqueue({
      id: context.deliveryId,
      idempotencyKey: context.deliveryId,
      payload,
      requestedAt,
      availableAt: requestedAt,
    })

    return {
      jobId: result.job.id,
      created: result.created,
    }
  }
}

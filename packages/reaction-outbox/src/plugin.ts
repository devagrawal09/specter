import type { ReactionDeliveryContext, ReactionPlugin } from '@specter-ts/core'
import { Effect } from 'effect'

import type { ReactionOutboxStore } from './types'

export type OutboxReactionPluginOptions<TEffect, TPayload = TEffect> = {
  readonly store: ReactionOutboxStore<TPayload>
  readonly map?: (
    effect: TEffect,
    context: ReactionDeliveryContext,
  ) => Promise<TPayload> | TPayload
}

export function createOutboxReactionPlugin<TEffect, TPayload = TEffect>(
  options: OutboxReactionPluginOptions<TEffect, TPayload>,
): ReactionPlugin<TEffect> {
  return () =>
    Effect.succeed((effect, context) =>
      Effect.tryPromise(async () => {
        const requestedAt = new Date(context.scheduledAt)
        if (Number.isNaN(requestedAt.getTime())) {
          throw new Error('Reaction delivery scheduledAt must be ISO-8601')
        }
        const payload = options.map
          ? await options.map(effect, context)
          : (effect as unknown as TPayload)
        await options.store.enqueue({
          id: context.deliveryId,
          idempotencyKey: context.deliveryId,
          payload,
          requestedAt,
          availableAt: requestedAt,
        })
      }),
    )
}

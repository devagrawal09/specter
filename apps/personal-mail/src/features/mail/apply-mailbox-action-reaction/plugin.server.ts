import type { ReactionPlugin } from '@specter-ts/core'
import { Context, Effect } from 'effect'

import type { ApplyMailboxActionEffect } from './impl'

export type GmailActionResult =
  | { status: 'applied'; gmailHistoryId: string }
  | { status: 'failed'; reason: string }
  | { status: 'reconciliationNeeded'; reason: string }

export class GmailActions extends Context.Service<
  GmailActions,
  {
    apply(
      effect: ApplyMailboxActionEffect,
      deliveryId: string,
    ): Promise<GmailActionResult>
  }
>()('@specter/personal-mail/GmailActions') {}

export const applyMailboxActionPlugin: ReactionPlugin<{
  type: 'applyMailboxAction'
  payload: ApplyMailboxActionEffect
}> = (command) =>
  Effect.gen(function* () {
    const gmail = yield* GmailActions
    return (output, context) =>
      Effect.gen(function* () {
        const result = yield* Effect.tryPromise(() =>
          gmail.apply(output.payload, context.deliveryId),
        )
        yield* command(
          {
            type: 'recordMailboxActionResult',
            payload: {
              ...output.payload,
              status: result.status,
              gmailHistoryId:
                result.status === 'applied' ? result.gmailHistoryId : '',
              reason: result.status === 'applied' ? '' : result.reason,
              occurredAt: context.scheduledAt,
            },
          },
          { idempotencyKey: `${context.deliveryId}:result` },
        )
      })
  })

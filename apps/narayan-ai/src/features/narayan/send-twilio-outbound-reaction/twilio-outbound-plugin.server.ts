import type { CommandDispatch, ReactionPlugin } from '@specter-ts/core'
import { Context, Effect } from 'effect'

import type {
  createTwilioDeliveryAttemptStore,
  TwilioDeliveryAttempt,
} from '../../../db/twilio-delivery-attempts'
import type { SendTwilioOutboundEffect } from './impl'

type TwilioMessage = {
  sid: string
  status?: string | null
  sentAt?: string
}

export type TwilioOutboundProvider = {
  send(effect: SendTwilioOutboundEffect): Promise<TwilioMessage>
  reconcile(attempt: TwilioDeliveryAttempt): Promise<TwilioMessage | undefined>
}

type AttemptStore = ReturnType<typeof createTwilioDeliveryAttemptStore>

export class TwilioDeliveryAttempts extends Context.Service<
  TwilioDeliveryAttempts,
  AttemptStore
>()('@specter/narayan/TwilioDeliveryAttempts') {}

export type TwilioOutboundPluginOptions = {
  provider?: TwilioOutboundProvider
  store?: () => AttemptStore
  now?: () => Date
  reconciliationGraceMs?: number
}

export class TwilioDeliveryReconciliationPendingError extends Error {
  constructor(readonly deliveryId: string) {
    super(
      `Twilio delivery ${deliveryId} has an ambiguous prior attempt; reconciliation is still pending`,
    )
    this.name = 'TwilioDeliveryReconciliationPendingError'
  }
}

export function createTwilioOutboundPlugin(
  options: TwilioOutboundPluginOptions = {},
): ReactionPlugin<{
  type: 'sendTwilioOutbound'
  payload: SendTwilioOutboundEffect
}> {
  const now = options.now ?? (() => new Date())
  const reconciliationGraceMs = options.reconciliationGraceMs ?? 60_000

  return (command) =>
    Effect.gen(function* () {
      const configuredStore = options.store?.()
      const contextStore = configuredStore ?? (yield* TwilioDeliveryAttempts)
      return (output, context) =>
        Effect.gen(function* () {
          const effect = output.payload
          const accountSid = process.env.TWILIO_ACCOUNT_SID
          const authToken = process.env.TWILIO_AUTH_TOKEN
          const from = process.env.TWILIO_WHATSAPP_FROM

          if (!options.provider && (!accountSid || !authToken || !from)) {
            yield* command(
              {
                type: 'recordTwilioMessageFailed',
                payload: {
                  outboundMessageId: effect.outboundMessageId,
                  error:
                    'Missing TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, or TWILIO_WHATSAPP_FROM',
                  failedAt: context.scheduledAt,
                },
              },
              { idempotencyKey: `${context.deliveryId}:failed` },
            )
            return
          }

          const provider =
            options.provider ??
            (yield* Effect.tryPromise(() =>
              createLiveTwilioProvider({
                accountSid: accountSid ?? '',
                authToken: authToken ?? '',
                from: from ?? '',
              }),
            ))
          const store = contextStore
          const existing = yield* Effect.tryPromise(() =>
            store.get(context.deliveryId),
          )

          if (existing?.status === 'sent' && existing.providerMessageSid) {
            yield* recordSent(
              command,
              context.deliveryId,
              effect.outboundMessageId,
              {
                sid: existing.providerMessageSid,
                status: existing.providerStatus,
                sentAt: existing.updatedAt,
              },
            )
            return
          }

          if (existing) {
            const reconciled = yield* Effect.tryPromise(() =>
              provider.reconcile(existing),
            )
            if (reconciled) {
              const reconciledAt = reconciled.sentAt ?? now().toISOString()
              yield* Effect.tryPromise(() =>
                store.markSent(context.deliveryId, reconciled, reconciledAt),
              )
              yield* recordSent(
                command,
                context.deliveryId,
                effect.outboundMessageId,
                {
                  ...reconciled,
                  sentAt: reconciledAt,
                },
              )
              return
            }

            const startedAt = new Date(existing.startedAt).getTime()
            if (now().getTime() - startedAt < reconciliationGraceMs) {
              return yield* Effect.fail(
                new TwilioDeliveryReconciliationPendingError(
                  context.deliveryId,
                ),
              )
            }
          }

          const attemptedAt = now().toISOString()
          yield* Effect.tryPromise(() =>
            store.begin({
              deliveryId: context.deliveryId,
              outboundMessageId: effect.outboundMessageId,
              to: effect.to,
              from: from ?? 'test-provider',
              body: effect.body,
              attemptNumber: (existing?.attemptNumber ?? 0) + 1,
              startedAt: attemptedAt,
            }),
          )

          // Twilio Programmable Messaging has no create-message idempotency key.
          // Persist-before-send plus SID/body reconciliation narrows the crash
          // window, but a provider response lost before it becomes list-visible
          // can still produce at-least-once delivery after the grace period.
          const message = yield* Effect.tryPromise(() =>
            provider.send(effect),
          ).pipe(
            Effect.tapError((cause) =>
              Effect.tryPromise(() =>
                store.markAmbiguous(
                  context.deliveryId,
                  cause instanceof Error ? cause.message : String(cause),
                  now().toISOString(),
                ),
              ),
            ),
          )
          const sentAt = message.sentAt ?? now().toISOString()
          yield* Effect.tryPromise(() =>
            store.markSent(context.deliveryId, message, sentAt),
          )
          yield* recordSent(
            command,
            context.deliveryId,
            effect.outboundMessageId,
            {
              ...message,
              sentAt,
            },
          )
        })
    })
}

export const twilioOutboundPlugin = createTwilioOutboundPlugin()

function recordSent(
  command: CommandDispatch,
  deliveryId: string,
  outboundMessageId: string,
  message: TwilioMessage & { sentAt?: string },
) {
  return command(
    {
      type: 'recordTwilioMessageSent',
      payload: {
        outboundMessageId,
        twilioMessageSid: message.sid,
        ...(message.status ? { status: message.status } : {}),
        sentAt: message.sentAt ?? new Date().toISOString(),
      },
    },
    { idempotencyKey: `${deliveryId}:sent` },
  )
}

async function createLiveTwilioProvider(input: {
  accountSid: string
  authToken: string
  from: string
}): Promise<TwilioOutboundProvider> {
  const { default: twilio } = await import('twilio')
  const client = twilio(input.accountSid, input.authToken)

  return {
    async send(effect) {
      const contentSid = process.env.TWILIO_CONTENT_SID
      const statusCallback = process.env.TWILIO_STATUS_CALLBACK_URL
      const message = await client.messages.create(
        contentSid
          ? {
              from: input.from,
              to: effect.to,
              contentSid,
              contentVariables: contentVariablesFor(effect),
              ...(statusCallback ? { statusCallback } : {}),
            }
          : {
              from: input.from,
              to: effect.to,
              body: effect.body,
              ...(statusCallback ? { statusCallback } : {}),
            },
      )
      return {
        sid: message.sid,
        status: message.status,
        sentAt: message.dateCreated?.toISOString(),
      }
    },
    async reconcile(attempt) {
      const earliest = new Date(new Date(attempt.startedAt).getTime() - 60_000)
      const messages = await client.messages.list({
        to: attempt.to,
        from: attempt.from,
        dateSentAfter: earliest,
        limit: 100,
      })
      const match = messages.find(
        (message) =>
          message.to === attempt.to &&
          message.from === attempt.from &&
          message.body === attempt.body &&
          message.dateCreated.getTime() >= earliest.getTime(),
      )
      return match
        ? {
            sid: match.sid,
            status: match.status,
            sentAt: match.dateCreated.toISOString(),
          }
        : undefined
    },
  }
}

function contentVariablesFor(effect: SendTwilioOutboundEffect) {
  const template = process.env.TWILIO_CONTENT_VARIABLES_JSON
  if (!template) {
    return JSON.stringify({ '1': effect.body, '2': 'Narayan AI' })
  }

  return template
    .replaceAll('{{body}}', effect.body)
    .replaceAll('{{to}}', effect.to)
    .replaceAll('{{outboundMessageId}}', effect.outboundMessageId)
}

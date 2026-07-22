import { describe, expect, it, vi } from 'vitest'
import { Effect } from 'effect'
import type { ReactionExec } from '@specter-ts/core'

import type { TwilioDeliveryAttempt } from '../../../db/twilio-delivery-attempts'
import {
  createTwilioOutboundPlugin,
  TwilioDeliveryReconciliationPendingError,
} from './twilio-outbound-plugin.server'

const effect = {
  type: 'sendTwilioOutbound' as const,
  payload: {
    outboundMessageId: 'outbound-1',
    to: 'whatsapp:+15550000001',
    body: 'Hello from Narayan',
  },
}

const context = {
  deliveryId: 'delivery-1',
  throughOrder: 1,
  scheduledAt: '2026-07-16T12:00:00.000Z',
  attemptId: 'delivery-1:attempt:2',
  attemptNumber: 2,
}

const ambiguousAttempt: TwilioDeliveryAttempt = {
  deliveryId: context.deliveryId,
  outboundMessageId: effect.payload.outboundMessageId,
  to: effect.payload.to,
  from: 'whatsapp:+15550000002',
  body: effect.payload.body,
  status: 'ambiguous',
  attemptNumber: 1,
  startedAt: '2026-07-16T11:59:50.000Z',
  updatedAt: '2026-07-16T11:59:51.000Z',
  providerMessageSid: null,
  providerStatus: null,
  lastError: 'connection reset after send',
}

function attemptStore(existing: TwilioDeliveryAttempt | undefined) {
  return {
    get: vi.fn(async () => existing),
    begin: vi.fn(async () => {}),
    markAmbiguous: vi.fn(async () => {}),
    markSent: vi.fn(async () => {}),
  }
}

describe('Twilio outbound delivery reconciliation', () => {
  it('reconciles an ambiguous provider response without sending a duplicate', async () => {
    const store = attemptStore(ambiguousAttempt)
    const provider = {
      send: vi.fn(async () => ({ sid: 'SM-duplicate' })),
      reconcile: vi.fn(async () => ({
        sid: 'SM-reconciled',
        status: 'queued',
        sentAt: '2026-07-16T11:59:50.500Z',
      })),
    }
    const command = vi.fn(() => Effect.void)
    const plugin = createTwilioOutboundPlugin({
      provider,
      store: () => store as never,
      now: () => new Date('2026-07-16T12:00:00.000Z'),
    })
    const execute = await Effect.runPromise(
      plugin(command) as Effect.Effect<ReactionExec<typeof effect>, unknown>,
    )

    await Effect.runPromise(execute(effect, context))

    expect(provider.send).not.toHaveBeenCalled()
    expect(store.markSent).toHaveBeenCalledWith(
      context.deliveryId,
      expect.objectContaining({ sid: 'SM-reconciled' }),
      '2026-07-16T11:59:50.500Z',
    )
    expect(command).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'recordTwilioMessageSent',
        payload: expect.objectContaining({
          outboundMessageId: effect.payload.outboundMessageId,
          twilioMessageSid: 'SM-reconciled',
        }),
      }),
      { idempotencyKey: `${context.deliveryId}:sent` },
    )
  })

  it('waits through the reconciliation grace period before permitting a resend', async () => {
    const store = attemptStore(ambiguousAttempt)
    const provider = {
      send: vi.fn(async () => ({ sid: 'SM-new' })),
      reconcile: vi.fn(async () => undefined),
    }
    const plugin = createTwilioOutboundPlugin({
      provider,
      store: () => store as never,
      now: () => new Date('2026-07-16T12:00:00.000Z'),
      reconciliationGraceMs: 60_000,
    })
    const execute = await Effect.runPromise(
      plugin(vi.fn(() => Effect.void)) as Effect.Effect<
        ReactionExec<typeof effect>,
        unknown
      >,
    )

    await expect(
      Effect.runPromise(execute(effect, context)),
    ).rejects.toBeInstanceOf(TwilioDeliveryReconciliationPendingError)
    expect(provider.send).not.toHaveBeenCalled()
  })
})

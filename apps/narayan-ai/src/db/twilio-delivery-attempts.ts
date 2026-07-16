import { eq } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import type { ScopedSqliteDb } from './specter-sqlite'

export const narayanTwilioDeliveryAttempts = sqliteTable(
  'narayan_twilio_delivery_attempts',
  {
    deliveryId: text('delivery_id').primaryKey(),
    outboundMessageId: text('outbound_message_id').notNull().unique(),
    to: text('to_phone').notNull(),
    from: text('from_phone').notNull(),
    body: text('body').notNull(),
    status: text('status', {
      enum: ['sending', 'ambiguous', 'sent'],
    }).notNull(),
    attemptNumber: integer('attempt_number').notNull(),
    startedAt: text('started_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    providerMessageSid: text('provider_message_sid'),
    providerStatus: text('provider_status'),
    lastError: text('last_error'),
  },
)

export type TwilioDeliveryAttempt =
  typeof narayanTwilioDeliveryAttempts.$inferSelect

export function createTwilioDeliveryAttemptStore(db: ScopedSqliteDb) {
  return {
    async get(deliveryId: string) {
      const rows = await db
        .select()
        .from(narayanTwilioDeliveryAttempts)
        .where(eq(narayanTwilioDeliveryAttempts.deliveryId, deliveryId))
        .all()
      return rows[0]
    },
    async findByProviderSid(providerMessageSid: string) {
      const rows = await db
        .select()
        .from(narayanTwilioDeliveryAttempts)
        .where(
          eq(
            narayanTwilioDeliveryAttempts.providerMessageSid,
            providerMessageSid,
          ),
        )
        .all()
      return rows[0]
    },
    async begin(input: {
      deliveryId: string
      outboundMessageId: string
      to: string
      from: string
      body: string
      attemptNumber: number
      startedAt: string
    }) {
      await db
        .insert(narayanTwilioDeliveryAttempts)
        .values({
          ...input,
          status: 'sending',
          updatedAt: input.startedAt,
        })
        .onConflictDoUpdate({
          target: narayanTwilioDeliveryAttempts.deliveryId,
          set: {
            status: 'sending',
            attemptNumber: input.attemptNumber,
            updatedAt: input.startedAt,
            lastError: null,
          },
        })
        .run()
    },
    async markAmbiguous(deliveryId: string, error: string, updatedAt: string) {
      await db
        .update(narayanTwilioDeliveryAttempts)
        .set({ status: 'ambiguous', lastError: error, updatedAt })
        .where(eq(narayanTwilioDeliveryAttempts.deliveryId, deliveryId))
        .run()
    },
    async markSent(
      deliveryId: string,
      message: { sid: string; status?: string | null },
      updatedAt: string,
    ) {
      await db
        .update(narayanTwilioDeliveryAttempts)
        .set({
          status: 'sent',
          providerMessageSid: message.sid,
          providerStatus: message.status ?? null,
          lastError: null,
          updatedAt,
        })
        .where(eq(narayanTwilioDeliveryAttempts.deliveryId, deliveryId))
        .run()
    },
  }
}

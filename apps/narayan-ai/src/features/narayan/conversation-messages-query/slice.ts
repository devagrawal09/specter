import { asc, eq } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'
import { createQuerySlice } from '@specter-ts/core'

import { sqliteSliceStore } from '../../../db/specter-sqlite'
import {
  assistantReplyGeneratedEvent,
  twilioInboundMessageRecordedEvent,
  twilioOutboundMessageFailedEvent,
  twilioOutboundMessageSentEvent,
} from '../events'

export const narayanConversationMessages = sqliteTable(
  'narayan_conversation_messages',
  {
    id: text('id').primaryKey(),
    phoneNumber: text('phone_number').notNull(),
    direction: text('direction', { enum: ['inbound', 'outbound'] }).notNull(),
    body: text('body').notNull(),
    status: text('status').notNull(),
    twilioMessageSid: text('twilio_message_sid'),
    relatedMessageId: text('related_message_id'),
    createdAt: text('created_at').notNull(),
    sortOrder: integer('sort_order').notNull(),
  },
)

const conversationMessagesQuery = createQuerySlice(
  'conversationMessagesQuery',
  'Lists inbound and outbound messages for a WhatsApp phone number.',
)
  .schema(z.object({ phoneNumber: z.string().min(1) }))
  .store(sqliteSliceStore)
  .apply({
    [twilioInboundMessageRecordedEvent.type]: async (event, db) => {
      const payload = await twilioInboundMessageRecordedEvent.decode(
        event.payload,
      )
      const sortOrder = (event as unknown as { order: number }).order

      await db
        .insert(narayanConversationMessages)
        .values({
          id: payload.inboundMessageId,
          phoneNumber: payload.from,
          direction: 'inbound',
          body: payload.body,
          status: 'received',
          twilioMessageSid: payload.twilioMessageSid,
          relatedMessageId: null,
          createdAt: payload.receivedAt,
          sortOrder,
        })
        .onConflictDoNothing()
        .run()
    },
    [assistantReplyGeneratedEvent.type]: async (event, db) => {
      const payload = await assistantReplyGeneratedEvent.decode(event.payload)
      const sortOrder = (event as unknown as { order: number }).order

      await db
        .insert(narayanConversationMessages)
        .values({
          id: payload.outboundMessageId,
          phoneNumber: payload.to,
          direction: 'outbound',
          body: payload.body,
          status: 'requested',
          twilioMessageSid: null,
          relatedMessageId: payload.inboundMessageId,
          createdAt: payload.generatedAt,
          sortOrder,
        })
        .onConflictDoNothing()
        .run()
    },
    [twilioOutboundMessageSentEvent.type]: async (event, db) => {
      const payload = await twilioOutboundMessageSentEvent.decode(event.payload)

      await db
        .update(narayanConversationMessages)
        .set({
          status: payload.status ?? 'sent',
          twilioMessageSid: payload.twilioMessageSid,
        })
        .where(eq(narayanConversationMessages.id, payload.outboundMessageId))
        .run()
    },
    [twilioOutboundMessageFailedEvent.type]: async (event, db) => {
      const payload = await twilioOutboundMessageFailedEvent.decode(event.payload)

      await db
        .update(narayanConversationMessages)
        .set({ status: `failed: ${payload.error}` })
        .where(eq(narayanConversationMessages.id, payload.outboundMessageId))
        .run()
    },
  })
  .handle(async (query, db) =>
    db
      .select()
      .from(narayanConversationMessages)
      .where(eq(narayanConversationMessages.phoneNumber, query.phoneNumber))
      .orderBy(asc(narayanConversationMessages.sortOrder))
      .all(),
  )

export default conversationMessagesQuery

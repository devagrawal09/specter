import { asc, eq } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'
import { createQuerySlice } from '@specter-ts/core'

import { sqliteSliceStore } from '../../../db/specter-sqlite'
import { eventSortOrder } from '../event-sort-order'
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
      const sortOrder = eventSortOrder(event)

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
      const sortOrder = eventSortOrder(event)

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
  .scenarios({
    description: 'Lists inbound and outbound messages in order.',
    given: [
      twilioInboundMessageRecordedEvent.create({
        inboundMessageId: 'inbound-message-scenario-1',
        twilioMessageSid: 'SM-message-scenario-1',
        from: 'whatsapp:+155****0001',
        to: 'whatsapp:+141****8886',
        body: 'Can I order sweets?',
        receivedAt: '2026-06-29T10:00:00.000Z',
      }),
      assistantReplyGeneratedEvent.create({
        inboundMessageId: 'inbound-message-scenario-1',
        outboundMessageId: 'outbound-message-scenario-1',
        to: 'whatsapp:+155****0001',
        body: 'Yes, what quantity?',
        generatedAt: '2026-06-29T10:00:05.000Z',
      }),
      twilioOutboundMessageSentEvent.create({
        outboundMessageId: 'outbound-message-scenario-1',
        twilioMessageSid: 'SM-outbound-message-scenario-1',
        status: 'delivered',
        sentAt: '2026-06-29T10:00:06.000Z',
      }),
    ],
    when: { phoneNumber: 'whatsapp:+155****0001' },
    expect: [
      {
        id: 'inbound-message-scenario-1',
        phoneNumber: 'whatsapp:+155****0001',
        direction: 'inbound',
        body: 'Can I order sweets?',
        status: 'received',
        twilioMessageSid: 'SM-message-scenario-1',
        relatedMessageId: null,
        createdAt: '2026-06-29T10:00:00.000Z',
        sortOrder: 1,
      },
      {
        id: 'outbound-message-scenario-1',
        phoneNumber: 'whatsapp:+155****0001',
        direction: 'outbound',
        body: 'Yes, what quantity?',
        status: 'delivered',
        twilioMessageSid: 'SM-outbound-message-scenario-1',
        relatedMessageId: 'inbound-message-scenario-1',
        createdAt: '2026-06-29T10:00:05.000Z',
        sortOrder: 2,
      },
    ],
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

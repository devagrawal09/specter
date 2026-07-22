import { asc, eq } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'

import { sqliteSliceStore } from '../../../db/specter-sqlite'
import { eventSortOrder } from '../event-sort-order'
import {
  assistantReplyGeneratedEvent,
  twilioInboundMessageRecordedEvent,
  twilioOutboundMessageFailedEvent,
  twilioOutboundMessageSentEvent,
} from '../events'
import specification from './spec.json' with { type: 'json' }
import { implementQuery } from '@specter-ts/core'

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

const messageSchema = z.object({
  id: z.string(),
  phoneNumber: z.string(),
  direction: z.enum(['inbound', 'outbound']),
  body: z.string(),
  status: z.string(),
  twilioMessageSid: z.string().nullable(),
  relatedMessageId: z.string().nullable(),
  createdAt: z.string(),
  sortOrder: z.number(),
})

const conversationMessagesQuery = implementQuery<'conversationMessagesQuery'>(
  specification,
)
  .inputSchema(z.object({ phoneNumber: z.string().min(1) }))
  .outputSchema(z.array(messageSchema))
  .store(sqliteSliceStore)
  .apply(twilioInboundMessageRecordedEvent, async (event, db) => {
    const payload = event.payload
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
        sortOrder: eventSortOrder(event),
      })
      .onConflictDoNothing()
      .run()
  })
  .apply(assistantReplyGeneratedEvent, async (event, db) => {
    const payload = event.payload
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
        sortOrder: eventSortOrder(event),
      })
      .onConflictDoNothing()
      .run()
  })
  .apply(twilioOutboundMessageSentEvent, async (event, db) => {
    const payload = event.payload
    await db
      .update(narayanConversationMessages)
      .set({
        status: payload.status ?? 'sent',
        twilioMessageSid: payload.twilioMessageSid,
      })
      .where(eq(narayanConversationMessages.id, payload.outboundMessageId))
      .run()
  })
  .apply(twilioOutboundMessageFailedEvent, async (event, db) => {
    const payload = event.payload
    await db
      .update(narayanConversationMessages)
      .set({ status: `failed: ${payload.error}` })
      .where(eq(narayanConversationMessages.id, payload.outboundMessageId))
      .run()
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

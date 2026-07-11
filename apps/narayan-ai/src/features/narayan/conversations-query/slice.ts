import { desc, eq } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'
import { createQuerySlice } from '@specter-ts/core'

import type { ScopedSqliteDb } from '../../../db/specter-sqlite'
import { sqliteSliceStore } from '../../../db/specter-sqlite'
import { eventSortOrder } from '../event-sort-order'
import {
  assistantReplyGeneratedEvent,
  twilioInboundMessageRecordedEvent,
  twilioOutboundMessageFailedEvent,
  twilioOutboundMessageSentEvent,
} from '../events'

export const narayanConversations = sqliteTable('narayan_conversations', {
  phoneNumber: text('phone_number').primaryKey(),
  lastMessageBody: text('last_message_body').notNull(),
  lastMessageDirection: text('last_message_direction', {
    enum: ['inbound', 'outbound'],
  }).notNull(),
  lastMessageStatus: text('last_message_status').notNull(),
  lastMessageAt: text('last_message_at').notNull(),
  messageCount: integer('message_count').notNull(),
  sortOrder: integer('sort_order').notNull(),
})

const conversationsQuery = createQuerySlice(
  'conversationsQuery',
  'Summarizes WhatsApp conversations by phone number.',
)
  .schema(z.object({}))
  .store(sqliteSliceStore)
  .apply({
    [twilioInboundMessageRecordedEvent.type]: async (event, db) => {
      const payload = await twilioInboundMessageRecordedEvent.decode(
        event.payload,
      )
      const sortOrder = eventSortOrder(event)
      await upsertConversation(db, {
        phoneNumber: payload.from,
        body: payload.body,
        direction: 'inbound',
        status: 'received',
        at: payload.receivedAt,
        sortOrder,
      })
    },
    [assistantReplyGeneratedEvent.type]: async (event, db) => {
      const payload = await assistantReplyGeneratedEvent.decode(event.payload)
      const sortOrder = eventSortOrder(event)
      await upsertConversation(db, {
        phoneNumber: payload.to,
        body: payload.body,
        direction: 'outbound',
        status: 'requested',
        at: payload.generatedAt,
        sortOrder,
      })
    },
    [twilioOutboundMessageSentEvent.type]: async (event, db) => {
      const payload = await twilioOutboundMessageSentEvent.decode(event.payload)
      const rows = await db
        .select()
        .from(narayanConversations)
        .orderBy(desc(narayanConversations.sortOrder))
        .all()
      const conversation = rows.find(
        (row) => row.lastMessageDirection === 'outbound',
      )
      if (!conversation) return
      await db
        .update(narayanConversations)
        .set({ lastMessageStatus: payload.status ?? 'sent' })
        .where(eq(narayanConversations.phoneNumber, conversation.phoneNumber))
        .run()
    },
    [twilioOutboundMessageFailedEvent.type]: async (event, db) => {
      const payload = await twilioOutboundMessageFailedEvent.decode(event.payload)
      const rows = await db
        .select()
        .from(narayanConversations)
        .orderBy(desc(narayanConversations.sortOrder))
        .all()
      const conversation = rows.find(
        (row) => row.lastMessageDirection === 'outbound',
      )
      if (!conversation) return
      await db
        .update(narayanConversations)
        .set({ lastMessageStatus: `failed: ${payload.error}` })
        .where(eq(narayanConversations.phoneNumber, conversation.phoneNumber))
        .run()
    },
  })
  .scenarios({
    description: 'Lists conversations with the latest message first.',
    given: [
      twilioInboundMessageRecordedEvent.create({
        inboundMessageId: 'inbound-conversation-scenario-1',
        twilioMessageSid: 'SM-conversation-scenario-1',
        from: 'whatsapp:+155****0001',
        to: 'whatsapp:+141****8886',
        body: 'Can I order sweets?',
        receivedAt: '2026-06-29T10:00:00.000Z',
      }),
      assistantReplyGeneratedEvent.create({
        inboundMessageId: 'inbound-conversation-scenario-1',
        outboundMessageId: 'outbound-conversation-scenario-1',
        to: 'whatsapp:+155****0001',
        body: 'Yes, what quantity?',
        generatedAt: '2026-06-29T10:00:05.000Z',
      }),
    ],
    when: {},
    expect: [
      {
        phoneNumber: 'whatsapp:+155****0001',
        lastMessageBody: 'Yes, what quantity?',
        lastMessageDirection: 'outbound',
        lastMessageStatus: 'requested',
        lastMessageAt: '2026-06-29T10:00:05.000Z',
        messageCount: 2,
        sortOrder: 2,
      },
    ],
  })
  .handle(async (_query, db) =>
    db
      .select()
      .from(narayanConversations)
      .orderBy(desc(narayanConversations.sortOrder))
      .all(),
  )

async function upsertConversation(
  db: ScopedSqliteDb,
  input: {
    phoneNumber: string
    body: string
    direction: 'inbound' | 'outbound'
    status: string
    at: string
    sortOrder: number
  },
) {
  const existing = await db
    .select()
    .from(narayanConversations)
    .where(eq(narayanConversations.phoneNumber, input.phoneNumber))
    .all()

  if (!existing[0]) {
    await db
      .insert(narayanConversations)
      .values({
        phoneNumber: input.phoneNumber,
        lastMessageBody: input.body,
        lastMessageDirection: input.direction,
        lastMessageStatus: input.status,
        lastMessageAt: input.at,
        messageCount: 1,
        sortOrder: input.sortOrder,
      })
      .run()
    return
  }

  await db
    .update(narayanConversations)
    .set({
      lastMessageBody: input.body,
      lastMessageDirection: input.direction,
      lastMessageStatus: input.status,
      lastMessageAt: input.at,
      messageCount: existing[0].messageCount + 1,
      sortOrder: input.sortOrder,
    })
    .where(eq(narayanConversations.phoneNumber, input.phoneNumber))
    .run()
}

export default conversationsQuery

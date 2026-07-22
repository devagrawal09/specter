import { desc, eq } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'

import type { ScopedSqliteDb } from '../../../db/specter-sqlite'
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

export const narayanConversations = sqliteTable('narayan_conversations', {
  phoneNumber: text('phone_number').primaryKey(),
  lastMessageId: text('last_message_id').notNull(),
  lastMessageBody: text('last_message_body').notNull(),
  lastMessageDirection: text('last_message_direction', {
    enum: ['inbound', 'outbound'],
  }).notNull(),
  lastMessageStatus: text('last_message_status').notNull(),
  lastMessageAt: text('last_message_at').notNull(),
  messageCount: integer('message_count').notNull(),
  sortOrder: integer('sort_order').notNull(),
})

const conversationsQuery = implementQuery<'conversationsQuery'>(specification)
  .inputSchema(z.object({}))
  .outputSchema(
    z.array(
      z.object({
        phoneNumber: z.string(),
        lastMessageBody: z.string(),
        lastMessageDirection: z.enum(['inbound', 'outbound']),
        lastMessageStatus: z.string(),
        lastMessageAt: z.string(),
        messageCount: z.number(),
        sortOrder: z.number(),
      }),
    ),
  )
  .store(sqliteSliceStore)
  .apply(twilioInboundMessageRecordedEvent, async (event, db) => {
    const payload = event.payload
    await upsertConversation(db, {
      phoneNumber: payload.from,
      messageId: payload.inboundMessageId,
      body: payload.body,
      direction: 'inbound',
      status: 'received',
      at: payload.receivedAt,
      sortOrder: eventSortOrder(event),
    })
  })
  .apply(assistantReplyGeneratedEvent, async (event, db) => {
    const payload = event.payload
    await upsertConversation(db, {
      phoneNumber: payload.to,
      messageId: payload.outboundMessageId,
      body: payload.body,
      direction: 'outbound',
      status: 'requested',
      at: payload.generatedAt,
      sortOrder: eventSortOrder(event),
    })
  })
  .apply(twilioOutboundMessageSentEvent, async (event, db) => {
    await updateOutboundStatus(
      db,
      event.payload.outboundMessageId,
      event.payload.status ?? 'sent',
    )
  })
  .apply(twilioOutboundMessageFailedEvent, async (event, db) => {
    await updateOutboundStatus(
      db,
      event.payload.outboundMessageId,
      `failed: ${event.payload.error}`,
    )
  })
  .handle(async (_query, db) =>
    db
      .select()
      .from(narayanConversations)
      .orderBy(desc(narayanConversations.sortOrder))
      .all(),
  )

async function updateOutboundStatus(
  db: ScopedSqliteDb,
  outboundMessageId: string,
  status: string,
) {
  await db
    .update(narayanConversations)
    .set({ lastMessageStatus: status })
    .where(eq(narayanConversations.lastMessageId, outboundMessageId))
    .run()
}

async function upsertConversation(
  db: ScopedSqliteDb,
  input: {
    phoneNumber: string
    messageId: string
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
        lastMessageId: input.messageId,
        lastMessageBody: input.body,
        lastMessageDirection: input.direction,
        lastMessageStatus: input.status,
        lastMessageAt: input.at,
        messageCount: 1,
        sortOrder: input.sortOrder,
      })
      .onConflictDoNothing()
      .run()
    return
  }

  await db
    .update(narayanConversations)
    .set({
      lastMessageBody: input.body,
      lastMessageId: input.messageId,
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

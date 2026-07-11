import { asc, eq } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { createReactionSlice } from '@specter-ts/core'

import { sqliteSliceStore } from '../../../db/specter-sqlite'
import {
  assistantReplyGeneratedEvent,
  twilioInboundMessageRecordedEvent,
} from '../events'
import { eventSortOrder } from '../event-sort-order'
import { mastraOpenRouterPlugin } from './mastra-openrouter-plugin.server'

export type ConversationHistoryMessage = {
  role: 'user' | 'assistant'
  body: string
}

export type GenerateAssistantReplyEffect = {
  inboundMessageId: string
  from: string
  body: string
  recentMessages: ConversationHistoryMessage[]
}

export const narayanAssistantReplyReactionInbound = sqliteTable(
  'narayan_assistant_reply_reaction_inbound',
  {
    inboundMessageId: text('inbound_message_id').primaryKey(),
    from: text('from_phone').notNull(),
    body: text('body').notNull(),
    receivedAt: text('received_at').notNull().default(''),
    sortOrder: integer('sort_order').notNull().default(0),
    replied: text('replied').notNull().default('false'),
  },
)

export const narayanAssistantReplyReactionMessages = sqliteTable(
  'narayan_assistant_reply_reaction_messages',
  {
    messageId: text('message_id').primaryKey(),
    phoneNumber: text('phone_number').notNull(),
    role: text('role', { enum: ['user', 'assistant'] }).notNull(),
    body: text('body').notNull(),
    createdAt: text('created_at').notNull(),
    sortOrder: integer('sort_order').notNull(),
  },
)

const generateAssistantReplyReaction = createReactionSlice(
  'generateAssistantReplyReaction',
  'Generates an assistant reply for inbound WhatsApp messages.',
)
  .payload<GenerateAssistantReplyEffect>()
  .plugin(mastraOpenRouterPlugin)
  .store(sqliteSliceStore)
  .scenarios(
    {
      description:
        'Includes the recent conversation when requesting an assistant reply.',
      given: [
        twilioInboundMessageRecordedEvent.create({
          inboundMessageId: 'inbound-history-1',
          twilioMessageSid: 'SM-history-1',
          from: 'whatsapp:+155****0001',
          to: 'whatsapp:+141****8886',
          body: 'Do you have marigold garlands?',
          receivedAt: '2026-06-29T10:00:00.000Z',
        }),
        assistantReplyGeneratedEvent.create({
          inboundMessageId: 'inbound-history-1',
          outboundMessageId: 'outbound-history-1',
          to: 'whatsapp:+155****0001',
          body: 'Yes, what time do you need them?',
          generatedAt: '2026-06-29T10:00:05.000Z',
        }),
        twilioInboundMessageRecordedEvent.create({
          inboundMessageId: 'inbound-history-2',
          twilioMessageSid: 'SM-history-2',
          from: 'whatsapp:+155****0001',
          to: 'whatsapp:+141****8886',
          body: 'By 5pm near Dashashwamedh.',
          receivedAt: '2026-06-29T10:05:00.000Z',
        }),
      ],
      expect: [
        {
          inboundMessageId: 'inbound-history-2',
          from: 'whatsapp:+155****0001',
          body: 'By 5pm near Dashashwamedh.',
          recentMessages: [
            { role: 'user', body: 'Do you have marigold garlands?' },
            { role: 'assistant', body: 'Yes, what time do you need them?' },
            { role: 'user', body: 'By 5pm near Dashashwamedh.' },
          ],
        },
      ],
    },
    {
      description: 'Starts a fresh session after the idle window.',
      given: [
        twilioInboundMessageRecordedEvent.create({
          inboundMessageId: 'inbound-old-1',
          twilioMessageSid: 'SM-old-1',
          from: 'whatsapp:+155****0002',
          to: 'whatsapp:+141****8886',
          body: 'I need flowers tomorrow.',
          receivedAt: '2026-06-29T08:00:00.000Z',
        }),
        assistantReplyGeneratedEvent.create({
          inboundMessageId: 'inbound-old-1',
          outboundMessageId: 'outbound-old-1',
          to: 'whatsapp:+155****0002',
          body: 'Sure, message us when ready.',
          generatedAt: '2026-06-29T08:00:05.000Z',
        }),
        twilioInboundMessageRecordedEvent.create({
          inboundMessageId: 'inbound-new-1',
          twilioMessageSid: 'SM-new-1',
          from: 'whatsapp:+155****0002',
          to: 'whatsapp:+141****8886',
          body: 'Can you deliver now?',
          receivedAt: '2026-06-29T10:05:00.000Z',
        }),
      ],
      expect: [
        {
          inboundMessageId: 'inbound-new-1',
          from: 'whatsapp:+155****0002',
          body: 'Can you deliver now?',
          recentMessages: [{ role: 'user', body: 'Can you deliver now?' }],
        },
      ],
    },
  )
  .apply({
    [twilioInboundMessageRecordedEvent.type]: async (event, db) => {
      const payload = await twilioInboundMessageRecordedEvent.decode(
        event.payload,
      )
      const sortOrder = eventSortOrder(event)
      await db
        .insert(narayanAssistantReplyReactionInbound)
        .values({
          inboundMessageId: payload.inboundMessageId,
          from: payload.from,
          body: payload.body,
          receivedAt: payload.receivedAt,
          sortOrder,
          replied: 'false',
        })
        .onConflictDoNothing()
        .run()
      await db
        .insert(narayanAssistantReplyReactionMessages)
        .values({
          messageId: payload.inboundMessageId,
          phoneNumber: payload.from,
          role: 'user',
          body: payload.body,
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
        .update(narayanAssistantReplyReactionInbound)
        .set({ replied: 'true' })
        .where(
          eq(
            narayanAssistantReplyReactionInbound.inboundMessageId,
            payload.inboundMessageId,
          ),
        )
        .run()
      await db
        .insert(narayanAssistantReplyReactionMessages)
        .values({
          messageId: payload.outboundMessageId,
          phoneNumber: payload.to,
          role: 'assistant',
          body: payload.body,
          createdAt: payload.generatedAt,
          sortOrder,
        })
        .onConflictDoNothing()
        .run()
    },
  })
  .handle(async (db) => {
    const rows = await db
      .select()
      .from(narayanAssistantReplyReactionInbound)
      .where(eq(narayanAssistantReplyReactionInbound.replied, 'false'))
      .orderBy(asc(narayanAssistantReplyReactionInbound.sortOrder))
      .all()

    const message = rows[0]
    if (!message) return undefined

    // ponytail: tiny per-user scan; add SQL windowing only if WhatsApp history grows large.
    const history = await db
      .select()
      .from(narayanAssistantReplyReactionMessages)
      .where(eq(narayanAssistantReplyReactionMessages.phoneNumber, message.from))
      .orderBy(asc(narayanAssistantReplyReactionMessages.sortOrder))
      .all()

    return {
      inboundMessageId: message.inboundMessageId,
      from: message.from,
      body: message.body,
      recentMessages: sessionMessages(
        history.filter((item) => item.sortOrder <= message.sortOrder),
      ),
    }
  })

function sessionMessages(
  messages: (typeof narayanAssistantReplyReactionMessages.$inferSelect)[],
): ConversationHistoryMessage[] {
  if (messages.length === 0) return []

  let start = 0
  for (let index = messages.length - 1; index > 0; index -= 1) {
    const current = Date.parse(messages[index].createdAt)
    const previous = Date.parse(messages[index - 1].createdAt)
    if (
      Number.isFinite(current) &&
      Number.isFinite(previous) &&
      current - previous > sessionIdleMs()
    ) {
      start = index
      break
    }
  }

  return messages.slice(start).map((message) => ({
    role: message.role,
    body: message.body,
  }))
}

function sessionIdleMs() {
  const minutes = Number(process.env.NARAYAN_AI_SESSION_IDLE_MINUTES ?? 60)
  return (Number.isFinite(minutes) && minutes > 0 ? minutes : 60) * 60_000
}

export default generateAssistantReplyReaction

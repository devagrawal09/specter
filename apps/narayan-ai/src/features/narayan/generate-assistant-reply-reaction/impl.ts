import { asc, eq } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'

import { sqliteSliceStore } from '../../../db/specter-sqlite'
import { eventSortOrder } from '../event-sort-order'
import {
  assistantReplyGeneratedEvent,
  twilioInboundMessageRecordedEvent,
} from '../events'
import { mastraOpenRouterPlugin } from './mastra-openrouter-plugin.server'
import spec from './spec'

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

const generateAssistantReplyReaction = spec
  .outputSchema(
    z.object({
      type: z.literal('generateAssistantReply'),
      payload: z.object({
        inboundMessageId: z.string(),
        from: z.string(),
        body: z.string(),
        recentMessages: z.array(
          z.object({ role: z.enum(['user', 'assistant']), body: z.string() }),
        ),
      }),
    }),
  )
  .plugin(mastraOpenRouterPlugin)
  .store(sqliteSliceStore)
  .apply(twilioInboundMessageRecordedEvent, async (event, db) => {
    const payload = event.payload
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
  })
  .apply(assistantReplyGeneratedEvent, async (event, db) => {
    const payload = event.payload
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
        sortOrder: eventSortOrder(event),
      })
      .onConflictDoNothing()
      .run()
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

    const history = await db
      .select()
      .from(narayanAssistantReplyReactionMessages)
      .where(
        eq(narayanAssistantReplyReactionMessages.phoneNumber, message.from),
      )
      .orderBy(asc(narayanAssistantReplyReactionMessages.sortOrder))
      .all()

    return {
      type: 'generateAssistantReply' as const,
      payload: {
        inboundMessageId: message.inboundMessageId,
        from: message.from,
        body: message.body,
        recentMessages: sessionMessages(
          history.filter((item) => item.sortOrder <= message.sortOrder),
        ),
      },
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

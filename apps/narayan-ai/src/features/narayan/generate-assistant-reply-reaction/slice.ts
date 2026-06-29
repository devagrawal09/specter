import { eq } from 'drizzle-orm'
import { sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { createReactionSlice } from '@specter-ts/core'

import { sqliteSliceStore } from '../../../db/specter-sqlite'
import {
  assistantReplyGeneratedEvent,
  twilioInboundMessageRecordedEvent,
} from '../events'
import { mastraOpenRouterPlugin } from './mastra-openrouter-plugin.server'

export type GenerateAssistantReplyEffect = {
  inboundMessageId: string
  from: string
  body: string
}

export const narayanAssistantReplyReactionInbound = sqliteTable(
  'narayan_assistant_reply_reaction_inbound',
  {
    inboundMessageId: text('inbound_message_id').primaryKey(),
    from: text('from_phone').notNull(),
    body: text('body').notNull(),
    replied: text('replied').notNull().default('false'),
  },
)

const generateAssistantReplyReaction = createReactionSlice(
  'generateAssistantReplyReaction',
  'Generates an assistant reply for inbound WhatsApp messages.',
)
  .payload<GenerateAssistantReplyEffect>()
  .plugin(mastraOpenRouterPlugin)
  .store(sqliteSliceStore)
  .apply({
    [twilioInboundMessageRecordedEvent.type]: async (event, db) => {
      const payload = await twilioInboundMessageRecordedEvent.decode(
        event.payload,
      )
      await db
        .insert(narayanAssistantReplyReactionInbound)
        .values({
          inboundMessageId: payload.inboundMessageId,
          from: payload.from,
          body: payload.body,
          replied: 'false',
        })
        .onConflictDoNothing()
        .run()
    },
    [assistantReplyGeneratedEvent.type]: async (event, db) => {
      const payload = await assistantReplyGeneratedEvent.decode(event.payload)
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
    },
  })
  .handle(async (db) => {
    const rows = await db
      .select()
      .from(narayanAssistantReplyReactionInbound)
      .where(eq(narayanAssistantReplyReactionInbound.replied, 'false'))
      .all()

    const message = rows[0]
    if (!message) return undefined

    return {
      inboundMessageId: message.inboundMessageId,
      from: message.from,
      body: message.body,
    }
  })

export default generateAssistantReplyReaction

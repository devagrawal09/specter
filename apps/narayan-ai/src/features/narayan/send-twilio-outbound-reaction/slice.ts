import { eq } from 'drizzle-orm'
import { sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { createReactionSlice } from '@specter-ts/core'

import { sqliteSliceStore } from '../../../db/specter-sqlite'
import {
  twilioOutboundMessageFailedEvent,
  twilioOutboundMessageRequestedEvent,
  twilioOutboundMessageSentEvent,
} from '../events'
import { twilioOutboundPlugin } from './twilio-outbound-plugin.server'

export type SendTwilioOutboundEffect = {
  outboundMessageId: string
  to: string
  body: string
}

export const narayanTwilioOutboundReactionMessages = sqliteTable(
  'narayan_twilio_outbound_reaction_messages',
  {
    outboundMessageId: text('outbound_message_id').primaryKey(),
    to: text('to_phone').notNull(),
    body: text('body').notNull(),
    status: text('status').notNull(),
  },
)

const sendTwilioOutboundReaction = createReactionSlice(
  'sendTwilioOutboundReaction',
  'Sends requested outbound WhatsApp messages through Twilio.',
)
  .payload<SendTwilioOutboundEffect>()
  .plugin(twilioOutboundPlugin)
  .store(sqliteSliceStore)
  .apply({
    [twilioOutboundMessageRequestedEvent.type]: async (event, db) => {
      const payload = await twilioOutboundMessageRequestedEvent.decode(
        event.payload,
      )
      await db
        .insert(narayanTwilioOutboundReactionMessages)
        .values({
          outboundMessageId: payload.outboundMessageId,
          to: payload.to,
          body: payload.body,
          status: 'requested',
        })
        .onConflictDoNothing()
        .run()
    },
    [twilioOutboundMessageSentEvent.type]: async (event, db) => {
      const payload = await twilioOutboundMessageSentEvent.decode(event.payload)
      await db
        .update(narayanTwilioOutboundReactionMessages)
        .set({ status: 'sent' })
        .where(
          eq(
            narayanTwilioOutboundReactionMessages.outboundMessageId,
            payload.outboundMessageId,
          ),
        )
        .run()
    },
    [twilioOutboundMessageFailedEvent.type]: async (event, db) => {
      const payload = await twilioOutboundMessageFailedEvent.decode(event.payload)
      await db
        .update(narayanTwilioOutboundReactionMessages)
        .set({ status: 'failed' })
        .where(
          eq(
            narayanTwilioOutboundReactionMessages.outboundMessageId,
            payload.outboundMessageId,
          ),
        )
        .run()
    },
  })
  .handle(async (db) => {
    const rows = await db
      .select()
      .from(narayanTwilioOutboundReactionMessages)
      .where(eq(narayanTwilioOutboundReactionMessages.status, 'requested'))
      .all()

    const message = rows[0]
    if (!message) return undefined

    return {
      outboundMessageId: message.outboundMessageId,
      to: message.to,
      body: message.body,
    }
  })

export default sendTwilioOutboundReaction

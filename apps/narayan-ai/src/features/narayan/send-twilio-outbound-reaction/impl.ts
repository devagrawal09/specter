import { eq } from 'drizzle-orm'
import { sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'

import { sqliteSliceStore } from '../../../db/specter-sqlite'
import {
  twilioOutboundMessageFailedEvent,
  twilioOutboundMessageRequestedEvent,
  twilioOutboundMessageSentEvent,
} from '../events'
import specification from './spec.json' with { type: 'json' }
import { implementReaction } from '@specter-ts/core'
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

const sendTwilioOutboundReaction =
  implementReaction<'sendTwilioOutboundReaction'>(specification)
    .outputSchema(
      z.object({
        type: z.literal('sendTwilioOutbound'),
        payload: z.object({
          outboundMessageId: z.string(),
          to: z.string(),
          body: z.string(),
        }),
      }),
    )
    .plugin(twilioOutboundPlugin)
    .store(sqliteSliceStore)
    .apply(twilioOutboundMessageRequestedEvent, async (event, db) => {
      const payload = event.payload
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
    })
    .apply(twilioOutboundMessageSentEvent, async (event, db) => {
      await db
        .update(narayanTwilioOutboundReactionMessages)
        .set({ status: 'sent' })
        .where(
          eq(
            narayanTwilioOutboundReactionMessages.outboundMessageId,
            event.payload.outboundMessageId,
          ),
        )
        .run()
    })
    .apply(twilioOutboundMessageFailedEvent, async (event, db) => {
      await db
        .update(narayanTwilioOutboundReactionMessages)
        .set({ status: 'failed' })
        .where(
          eq(
            narayanTwilioOutboundReactionMessages.outboundMessageId,
            event.payload.outboundMessageId,
          ),
        )
        .run()
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
        type: 'sendTwilioOutbound' as const,
        payload: {
          outboundMessageId: message.outboundMessageId,
          to: message.to,
          body: message.body,
        },
      }
    })

export default sendTwilioOutboundReaction

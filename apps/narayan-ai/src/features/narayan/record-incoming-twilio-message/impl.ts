import { eq } from 'drizzle-orm'
import { sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'

import { sqliteSliceStore } from '../../../db/specter-sqlite'
import {
  twilioInboundDuplicateIgnoredEvent,
  twilioInboundMessageRecordedEvent,
} from '../events'
import specification from './spec.json' with { type: 'json' }
import { implementCommand } from '@specter-ts/core'

export const narayanInboundCommandMessages = sqliteTable(
  'narayan_inbound_command_messages',
  {
    twilioMessageSid: text('twilio_message_sid').primaryKey(),
    inboundMessageId: text('inbound_message_id').notNull(),
  },
)

const recordIncomingTwilioMessage =
  implementCommand<'recordIncomingTwilioMessage'>(specification)
    .inputSchema(
      z.object({
        inboundMessageId: z.string().min(1),
        twilioMessageSid: z.string().min(1),
        from: z.string().min(1),
        to: z.string().min(1),
        body: z.string(),
        receivedAt: z.string().min(1),
      }),
    )
    .store(sqliteSliceStore)
    .apply(twilioInboundMessageRecordedEvent, async (event, db) => {
      await db
        .insert(narayanInboundCommandMessages)
        .values({
          twilioMessageSid: event.payload.twilioMessageSid,
          inboundMessageId: event.payload.inboundMessageId,
        })
        .onConflictDoNothing()
        .run()
    })
    .handle(async (command, db) => {
      const existing = await db
        .select()
        .from(narayanInboundCommandMessages)
        .where(
          eq(
            narayanInboundCommandMessages.twilioMessageSid,
            command.twilioMessageSid,
          ),
        )
        .all()

      if (existing[0]) {
        return [
          twilioInboundDuplicateIgnoredEvent.create({
            twilioMessageSid: command.twilioMessageSid,
            from: command.from,
            to: command.to,
            body: command.body,
            receivedAt: command.receivedAt,
          }),
        ]
      }

      return [twilioInboundMessageRecordedEvent.create(command)]
    })

export default recordIncomingTwilioMessage

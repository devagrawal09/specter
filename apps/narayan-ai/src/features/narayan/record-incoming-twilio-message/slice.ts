import { eq } from 'drizzle-orm'
import { sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'
import { createCommandSlice } from '@specter-ts/core'

import { sqliteSliceStore } from '../../../db/specter-sqlite'
import {
  twilioInboundDuplicateIgnoredEvent,
  twilioInboundMessageRecordedEvent,
} from '../events'

export const narayanInboundCommandMessages = sqliteTable(
  'narayan_inbound_command_messages',
  {
    twilioMessageSid: text('twilio_message_sid').primaryKey(),
    inboundMessageId: text('inbound_message_id').notNull(),
  },
)

const recordIncomingTwilioMessage = createCommandSlice(
  'recordIncomingTwilioMessage',
  'Records an inbound Twilio WhatsApp message once.',
)
  .schema(
    z.object({
      twilioMessageSid: z.string().min(1),
      from: z.string().min(1),
      to: z.string().min(1),
      body: z.string().default(''),
      receivedAt: z.string().optional(),
    }),
  )
  .store(sqliteSliceStore)
  .apply({
    [twilioInboundMessageRecordedEvent.type]: async (event, db) => {
      const payload = await twilioInboundMessageRecordedEvent.decode(
        event.payload,
      )

      await db
        .insert(narayanInboundCommandMessages)
        .values({
          twilioMessageSid: payload.twilioMessageSid,
          inboundMessageId: payload.inboundMessageId,
        })
        .onConflictDoNothing()
        .run()
    },
  })
  .handle(async (command, db) => {
    const receivedAt = command.receivedAt ?? new Date().toISOString()
    const existing = await db
      .select()
      .from(narayanInboundCommandMessages)
      .where(
        eq(narayanInboundCommandMessages.twilioMessageSid, command.twilioMessageSid),
      )
      .all()

    if (existing[0]) {
      return [
        twilioInboundDuplicateIgnoredEvent.create({
          twilioMessageSid: command.twilioMessageSid,
          from: command.from,
          to: command.to,
          body: command.body,
          receivedAt,
        }),
      ]
    }

    return [
      twilioInboundMessageRecordedEvent.create({
        inboundMessageId: crypto.randomUUID(),
        twilioMessageSid: command.twilioMessageSid,
        from: command.from,
        to: command.to,
        body: command.body,
        receivedAt,
      }),
    ]
  })

export default recordIncomingTwilioMessage

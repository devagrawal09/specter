import { z } from 'zod'
import { createCommandSlice } from '@specter-ts/core'

import { sqliteSliceStore } from '../../../db/specter-sqlite'
import { twilioOutboundMessageSentEvent } from '../events'

const recordTwilioMessageSent = createCommandSlice(
  'recordTwilioMessageSent',
  'Records a successful Twilio outbound send.',
)
  .schema(
    z.object({
      outboundMessageId: z.string().min(1),
      twilioMessageSid: z.string().min(1),
      status: z.string().optional(),
      sentAt: z.string().optional(),
    }),
  )
  .store(sqliteSliceStore)
  .scenarios({
    description: 'Records Twilio send status.',
    given: [],
    when: {
      outboundMessageId: 'outbound-sent-scenario-1',
      twilioMessageSid: 'SM-sent-scenario-1',
      status: 'delivered',
      sentAt: '2026-06-29T10:02:00.000Z',
    },
    expect: [
      twilioOutboundMessageSentEvent.create({
        outboundMessageId: 'outbound-sent-scenario-1',
        twilioMessageSid: 'SM-sent-scenario-1',
        status: 'delivered',
        sentAt: '2026-06-29T10:02:00.000Z',
      }),
    ],
  })
  .handle(async (command) => [
    twilioOutboundMessageSentEvent.create({
      outboundMessageId: command.outboundMessageId,
      twilioMessageSid: command.twilioMessageSid,
      status: command.status,
      sentAt: command.sentAt ?? new Date().toISOString(),
    }),
  ])

export default recordTwilioMessageSent

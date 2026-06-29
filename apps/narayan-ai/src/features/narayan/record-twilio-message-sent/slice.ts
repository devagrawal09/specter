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
    }),
  )
  .store(sqliteSliceStore)
  .handle(async (command) => [
    twilioOutboundMessageSentEvent.create({
      outboundMessageId: command.outboundMessageId,
      twilioMessageSid: command.twilioMessageSid,
      status: command.status,
      sentAt: new Date().toISOString(),
    }),
  ])

export default recordTwilioMessageSent

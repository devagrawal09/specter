import { z } from 'zod'

import { sqliteSliceStore } from '../../../db/specter-sqlite'
import { twilioOutboundMessageSentEvent } from '../events'
import spec from './spec'

const recordTwilioMessageSent = spec
  .inputSchema(
    z.object({
      outboundMessageId: z.string().min(1),
      twilioMessageSid: z.string().min(1),
      status: z.string().optional(),
      sentAt: z.string().min(1),
    }),
  )
  .store(sqliteSliceStore)
  .handle(async (command) => [twilioOutboundMessageSentEvent.create(command)])

export default recordTwilioMessageSent

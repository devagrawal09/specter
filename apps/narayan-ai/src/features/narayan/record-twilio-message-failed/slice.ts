import { z } from 'zod'
import { createCommandSlice } from '@specter-ts/core'

import { sqliteSliceStore } from '../../../db/specter-sqlite'
import { twilioOutboundMessageFailedEvent } from '../events'

const recordTwilioMessageFailed = createCommandSlice(
  'recordTwilioMessageFailed',
  'Records a failed Twilio outbound send.',
)
  .schema(
    z.object({
      outboundMessageId: z.string().min(1),
      error: z.string().min(1),
    }),
  )
  .store(sqliteSliceStore)
  .handle(async (command) => [
    twilioOutboundMessageFailedEvent.create({
      outboundMessageId: command.outboundMessageId,
      error: command.error,
      failedAt: new Date().toISOString(),
    }),
  ])

export default recordTwilioMessageFailed

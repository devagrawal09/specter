import { z } from 'zod'

import { sqliteSliceStore } from '../../../db/specter-sqlite'
import { twilioOutboundMessageFailedEvent } from '../events'
import spec from './spec'

const recordTwilioMessageFailed = spec
  .inputSchema(
    z.object({
      outboundMessageId: z.string().min(1),
      error: z.string().min(1),
      failedAt: z.string().min(1),
    }),
  )
  .store(sqliteSliceStore)
  .handle(async (command) => [twilioOutboundMessageFailedEvent.create(command)])

export default recordTwilioMessageFailed

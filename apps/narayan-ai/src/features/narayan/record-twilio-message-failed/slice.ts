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
      failedAt: z.string().optional(),
    }),
  )
  .store(sqliteSliceStore)
  .scenarios({
    description: 'Records Twilio send failures.',
    given: [],
    when: {
      outboundMessageId: 'outbound-failed-scenario-1',
      error: 'Twilio rejected the message',
      failedAt: '2026-06-29T10:03:00.000Z',
    },
    expect: [
      twilioOutboundMessageFailedEvent.create({
        outboundMessageId: 'outbound-failed-scenario-1',
        error: 'Twilio rejected the message',
        failedAt: '2026-06-29T10:03:00.000Z',
      }),
    ],
  })
  .handle(async (command) => [
    twilioOutboundMessageFailedEvent.create({
      outboundMessageId: command.outboundMessageId,
      error: command.error,
      failedAt: command.failedAt ?? new Date().toISOString(),
    }),
  ])

export default recordTwilioMessageFailed

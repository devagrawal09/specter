import { z } from 'zod'
import { createCommandSlice } from '@specter-ts/core'

import { sqliteSliceStore } from '../../../db/specter-sqlite'
import {
  assistantReplyGeneratedEvent,
  twilioOutboundMessageRequestedEvent,
} from '../events'

const recordAssistantReply = createCommandSlice(
  'recordAssistantReply',
  'Records an assistant reply and requests Twilio delivery.',
)
  .schema(
    z.object({
      inboundMessageId: z.string().min(1),
      to: z.string().min(1),
      body: z.string().min(1),
    }),
  )
  .store(sqliteSliceStore)
  .handle(async (command) => {
    const outboundMessageId = crypto.randomUUID()
    const now = new Date().toISOString()

    return [
      assistantReplyGeneratedEvent.create({
        inboundMessageId: command.inboundMessageId,
        outboundMessageId,
        to: command.to,
        body: command.body,
        generatedAt: now,
      }),
      twilioOutboundMessageRequestedEvent.create({
        inboundMessageId: command.inboundMessageId,
        outboundMessageId,
        to: command.to,
        body: command.body,
        requestedAt: now,
      }),
    ]
  })

export default recordAssistantReply

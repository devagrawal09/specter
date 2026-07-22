import { z } from 'zod'

import { sqliteSliceStore } from '../../../db/specter-store'
import {
  assistantReplyGeneratedEvent,
  twilioOutboundMessageRequestedEvent,
} from '../events'
import specification from './spec.json' with { type: 'json' }
import { implementCommand } from '@specter-ts/core'

const recordAssistantReply = implementCommand(specification)
  .inputSchema(
    z.object({
      inboundMessageId: z.string().min(1),
      outboundMessageId: z.string().min(1),
      to: z.string().min(1),
      body: z.string().min(1),
      generatedAt: z.string().min(1),
    }),
  )
  .store(sqliteSliceStore)
  .handle(async (command) => [
    assistantReplyGeneratedEvent.create({
      inboundMessageId: command.inboundMessageId,
      outboundMessageId: command.outboundMessageId,
      to: command.to,
      body: command.body,
      generatedAt: command.generatedAt,
    }),
    twilioOutboundMessageRequestedEvent.create({
      inboundMessageId: command.inboundMessageId,
      outboundMessageId: command.outboundMessageId,
      to: command.to,
      body: command.body,
      requestedAt: command.generatedAt,
    }),
  ])

export default recordAssistantReply

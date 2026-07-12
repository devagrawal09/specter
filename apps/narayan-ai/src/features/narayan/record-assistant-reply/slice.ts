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
      generatedAt: z.string().optional(),
    }),
  )
  .store(sqliteSliceStore)
  .scenarios({
    description: 'Records an assistant reply and requests Twilio delivery.',
    given: [],
    when: {
      inboundMessageId: 'inbound-reply-scenario-1',
      to: 'whatsapp:+155****0001',
      body: 'Yes, we can help.',
      generatedAt: '2026-06-29T10:01:00.000Z',
    },
    expect: [
      assistantReplyGeneratedEvent.create({
        inboundMessageId: 'inbound-reply-scenario-1',
        outboundMessageId: 'generated',
        to: 'whatsapp:+155****0001',
        body: 'Yes, we can help.',
        generatedAt: '2026-06-29T10:01:00.000Z',
      }),
      twilioOutboundMessageRequestedEvent.create({
        inboundMessageId: 'inbound-reply-scenario-1',
        outboundMessageId: 'generated',
        to: 'whatsapp:+155****0001',
        body: 'Yes, we can help.',
        requestedAt: '2026-06-29T10:01:00.000Z',
      }),
    ],
  })
  .handle(async (command) => {
    const outboundMessageId = crypto.randomUUID()
    const now = command.generatedAt ?? new Date().toISOString()

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

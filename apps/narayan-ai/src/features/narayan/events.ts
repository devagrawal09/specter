import { z } from 'zod'
import { createEventDefinition } from '@specter-ts/core'

export const twilioInboundMessageRecordedEvent = createEventDefinition(
  'twilioInboundMessageRecorded',
  z.object({
    inboundMessageId: z.string(),
    twilioMessageSid: z.string(),
    from: z.string(),
    to: z.string(),
    body: z.string(),
    receivedAt: z.string(),
  }),
)

export const twilioInboundDuplicateIgnoredEvent = createEventDefinition(
  'twilioInboundDuplicateIgnored',
  z.object({
    twilioMessageSid: z.string(),
    from: z.string(),
    to: z.string(),
    body: z.string(),
    receivedAt: z.string(),
  }),
)

export const assistantReplyGeneratedEvent = createEventDefinition(
  'assistantReplyGenerated',
  z.object({
    inboundMessageId: z.string(),
    outboundMessageId: z.string(),
    to: z.string(),
    body: z.string(),
    generatedAt: z.string(),
  }),
)

export const twilioOutboundMessageRequestedEvent = createEventDefinition(
  'twilioOutboundMessageRequested',
  z.object({
    outboundMessageId: z.string(),
    inboundMessageId: z.string(),
    to: z.string(),
    body: z.string(),
    requestedAt: z.string(),
  }),
)

export const twilioOutboundMessageSentEvent = createEventDefinition(
  'twilioOutboundMessageSent',
  z.object({
    outboundMessageId: z.string(),
    twilioMessageSid: z.string(),
    status: z.string().optional(),
    sentAt: z.string(),
  }),
)

export const twilioOutboundMessageFailedEvent = createEventDefinition(
  'twilioOutboundMessageFailed',
  z.object({
    outboundMessageId: z.string(),
    error: z.string(),
    failedAt: z.string(),
  }),
)

export const narayanEventDefinitions = [
  twilioInboundMessageRecordedEvent,
  twilioInboundDuplicateIgnoredEvent,
  assistantReplyGeneratedEvent,
  twilioOutboundMessageRequestedEvent,
  twilioOutboundMessageSentEvent,
  twilioOutboundMessageFailedEvent,
] as const

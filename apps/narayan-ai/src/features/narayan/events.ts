import { z } from 'zod'
import { createEventDefinition } from '@specter-ts/core'

export const twilioInboundMessageRecordedEvent = createEventDefinition(
  'twilio-inbound-message-recorded',
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
  'twilio-inbound-duplicate-ignored',
  z.object({
    twilioMessageSid: z.string(),
    from: z.string(),
    to: z.string(),
    body: z.string(),
    receivedAt: z.string(),
  }),
)

export const assistantReplyGeneratedEvent = createEventDefinition(
  'assistant-reply-generated',
  z.object({
    inboundMessageId: z.string(),
    outboundMessageId: z.string(),
    to: z.string(),
    body: z.string(),
    generatedAt: z.string(),
  }),
)

export const twilioOutboundMessageRequestedEvent = createEventDefinition(
  'twilio-outbound-message-requested',
  z.object({
    outboundMessageId: z.string(),
    inboundMessageId: z.string(),
    to: z.string(),
    body: z.string(),
    requestedAt: z.string(),
  }),
)

export const twilioOutboundMessageSentEvent = createEventDefinition(
  'twilio-outbound-message-sent',
  z.object({
    outboundMessageId: z.string(),
    twilioMessageSid: z.string(),
    status: z.string().optional(),
    sentAt: z.string(),
  }),
)

export const twilioOutboundMessageFailedEvent = createEventDefinition(
  'twilio-outbound-message-failed',
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

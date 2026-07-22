import conversationMessagesQuery from './conversation-messages-query/impl'
import conversationsQuery from './conversations-query/impl'
import generateAssistantReplyReaction from './generate-assistant-reply-reaction/impl'
import recordAssistantReply from './record-assistant-reply/impl'
import recordIncomingTwilioMessage from './record-incoming-twilio-message/impl'
import recordTwilioMessageFailed from './record-twilio-message-failed/impl'
import recordTwilioMessageSent from './record-twilio-message-sent/impl'
import sendTwilioOutboundReaction from './send-twilio-outbound-reaction/impl'
import { narayanEventDefinitions } from './events'

export const narayanRegistrations = [
  recordIncomingTwilioMessage,
  recordAssistantReply,
  recordTwilioMessageSent,
  recordTwilioMessageFailed,
  generateAssistantReplyReaction,
  sendTwilioOutboundReaction,
  conversationsQuery,
  conversationMessagesQuery,
] as const

export const narayanSpecterAppConfig = {
  events: narayanEventDefinitions,
  slices: narayanRegistrations,
} as const

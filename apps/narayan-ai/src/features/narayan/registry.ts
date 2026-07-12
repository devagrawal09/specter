import { sqliteEventLog } from '../../db/specter-sqlite'
import { memoryReactionScheduler } from '../../testing/memory-reaction-scheduler'
import conversationMessagesQuery from './conversation-messages-query/slice'
import conversationsQuery from './conversations-query/slice'
import generateAssistantReplyReaction from './generate-assistant-reply-reaction/slice'
import recordAssistantReply from './record-assistant-reply/slice'
import recordIncomingTwilioMessage from './record-incoming-twilio-message/slice'
import recordTwilioMessageFailed from './record-twilio-message-failed/slice'
import recordTwilioMessageSent from './record-twilio-message-sent/slice'
import sendTwilioOutboundReaction from './send-twilio-outbound-reaction/slice'
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
  eventLog: sqliteEventLog,
  schedule: memoryReactionScheduler,
  slices: narayanRegistrations,
} as const

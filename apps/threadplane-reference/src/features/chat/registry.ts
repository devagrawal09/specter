import { memoryEventLog } from '../../testing/memory-event-log'
import chatMessagesQuery from './chat-messages-query/slice'
import postMessage from './post-message/slice'
import recordAgentReply from './record-agent-reply/slice'
import simulatedAgentReplyReaction from './simulated-agent-reply-reaction/slice'
import { chatEventDefinitions } from './events'

export const chatRegistrations = [
  postMessage,
  recordAgentReply,
  simulatedAgentReplyReaction,
  chatMessagesQuery,
] as const

export const chatSpecterAppConfig = {
  events: chatEventDefinitions,
  eventLog: memoryEventLog,
  slices: chatRegistrations,
} as const

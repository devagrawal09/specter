import { sqliteEventLog } from '../../db/specter-sqlite'
import { memoryReactionScheduler } from '../../testing/memory-reaction-scheduler'
import chatMessagesQuery from './chat-messages-query/slice'
import postMessage from './post-message/slice'
import recordAgentReply from './record-agent-reply/slice'
import simulatedAgentReplyReaction from './simulated-agent-reply-reaction/slice'
import { chatEventDefinitions } from './events'
import {
  workspaceEventDefinitions,
  workspaceRegistrations,
} from '../workspaces/registry'

export const chatRegistrations = [
  postMessage,
  recordAgentReply,
  simulatedAgentReplyReaction,
  chatMessagesQuery,
] as const

export const threadplaneReferenceRegistrations = [
  ...workspaceRegistrations,
  ...chatRegistrations,
] as const

export const threadplaneReferenceEventDefinitions = [
  ...workspaceEventDefinitions,
  ...chatEventDefinitions,
] as const

export const threadplaneReferenceSpecterAppConfig = {
  events: threadplaneReferenceEventDefinitions,
  eventLog: sqliteEventLog,
  schedule: memoryReactionScheduler,
  slices: threadplaneReferenceRegistrations,
} as const

export const chatSpecterAppConfig = {
  events: chatEventDefinitions,
  eventLog: sqliteEventLog,
  schedule: memoryReactionScheduler,
  slices: chatRegistrations,
} as const

import agentReactionWithMastraPlugin from './agent-reaction-with-mastra-plugin/slice'
import createPost from './create-post/slice'
import createWorkspace from './create-workspace/slice'
import replyToPost from './reply-to-post/slice'
import triggerAgent from './trigger-agent/slice'
import triggerAgentReaction from './trigger-agent-reaction/slice'
import { threadplaneEventDefinitions } from './events'
import workspaceChat from './workspace-chat/slice'
import workspaceList from './workspace-list/slice'

export { threadplaneEventDefinitions }

export const threadplaneSliceSkeletons = [
  createWorkspace,
  createPost,
  replyToPost,
  triggerAgent,
  workspaceList,
  workspaceChat,
  triggerAgentReaction,
  agentReactionWithMastraPlugin,
] as const

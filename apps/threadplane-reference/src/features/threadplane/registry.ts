import agentRunWithHarnessAgentPlugin from './agent-run-with-harness-agent-plugin/slice'
import createPost from './create-post/slice'
import createWorkspace from './create-workspace/slice'
import recordAgentRunCompleted from './record-agent-run-completed/slice'
import recordAgentRunFailed from './record-agent-run-failed/slice'
import recordAgentRunStarted from './record-agent-run-started/slice'
import recordAgentRunStreamed from './record-agent-run-streamed/slice'
import recordToolCallCompleted from './record-tool-call-completed/slice'
import recordToolCallFailed from './record-tool-call-failed/slice'
import recordToolCallStarted from './record-tool-call-started/slice'
import replyToPost from './reply-to-post/slice'
import requestAgentRun from './request-agent-run/slice'
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
  requestAgentRun,
  recordAgentRunStarted,
  recordAgentRunStreamed,
  recordAgentRunCompleted,
  recordAgentRunFailed,
  recordToolCallStarted,
  recordToolCallCompleted,
  recordToolCallFailed,
  triggerAgent,
  workspaceList,
  workspaceChat,
  triggerAgentReaction,
  agentRunWithHarnessAgentPlugin,
] as const

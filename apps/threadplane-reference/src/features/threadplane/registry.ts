import agentRunTimeline from './agent-run-timeline/impl'
import createPost from './create-post/impl'
import createWorkspace from './create-workspace/impl'
import filesystemTree from './workspace-filesystem-tree/impl'
import filesystemStatus from './workspace-filesystem-status/impl'
import publishAgentRunReply from './publish-agent-run-reply/impl'
import recordAgentRunCompleted from './record-agent-run-completed/impl'
import recordAgentRunFailed from './record-agent-run-failed/impl'
import recordAgentRunStarted from './record-agent-run-started/impl'
import recordAgentRunStreamed from './record-agent-run-streamed/impl'
import recordFilesystemNodeChanged from './record-filesystem-node-changed/impl'
import recordFilesystemNodeDeleted from './record-filesystem-node-deleted/impl'
import recordFilesystemNodeDiscovered from './record-filesystem-node-discovered/impl'
import recordToolCallCompleted from './record-tool-call-completed/impl'
import recordToolCallFailed from './record-tool-call-failed/impl'
import recordToolCallStarted from './record-tool-call-started/impl'
import recordVisibleAgentReply from './record-visible-agent-reply/impl'
import recordWorkspaceFilesystemScanCompleted from './record-workspace-filesystem-scan-completed/impl'
import recordWorkspaceFilesystemScanFailed from './record-workspace-filesystem-scan-failed/impl'
import recordWorkspaceFilesystemScanStarted from './record-workspace-filesystem-scan-started/impl'
import replyToPost from './reply-to-post/impl'
import requestAgentRun from './request-agent-run/impl'
import requestWorkspaceFilesystemScan from './request-workspace-filesystem-scan/impl'
import runRequestedAgentRun from './run-requested-agent-run/impl'
import runRequestedFilesystemScan from './run-requested-filesystem-scan/impl'
import workspaceAgentRuns from './workspace-agent-runs/impl'
import workspaceChat from './workspace-chat/impl'
import workspaceList from './workspace-list/impl'
import { threadplaneEventDefinitions } from './events'

export { threadplaneEventDefinitions }

export const threadplaneScaffoldRegistrations = [
  createWorkspace,
  workspaceList,
  createPost,
  replyToPost,
  recordVisibleAgentReply,
  workspaceChat,
  requestWorkspaceFilesystemScan,
  recordWorkspaceFilesystemScanStarted,
  recordWorkspaceFilesystemScanCompleted,
  recordWorkspaceFilesystemScanFailed,
  recordFilesystemNodeDiscovered,
  recordFilesystemNodeChanged,
  recordFilesystemNodeDeleted,
  filesystemStatus,
  filesystemTree,
  requestAgentRun,
  recordAgentRunStarted,
  recordAgentRunStreamed,
  recordAgentRunCompleted,
  recordAgentRunFailed,
  recordToolCallStarted,
  recordToolCallCompleted,
  recordToolCallFailed,
  workspaceAgentRuns,
  agentRunTimeline,
  runRequestedFilesystemScan,
  runRequestedAgentRun,
  publishAgentRunReply,
] as const

export const threadplaneSliceSkeletons = threadplaneScaffoldRegistrations

export const threadplaneReferenceSpecterAppConfig = {
  events: threadplaneEventDefinitions,
  slices: threadplaneScaffoldRegistrations,
} as const

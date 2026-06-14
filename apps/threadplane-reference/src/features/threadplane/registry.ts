import { sqliteEventLog } from '../../db/specter-sqlite'
import { memoryReactionScheduler } from '../../testing/memory-reaction-scheduler'
import agentRunTimeline from './agent-run-timeline/slice'
import createPost from './create-post/slice'
import createWorkspace from './create-workspace/slice'
import filesystemTree from './workspace-filesystem-tree/slice'
import filesystemStatus from './workspace-filesystem-status/slice'
import publishAgentRunReply from './publish-agent-run-reply/slice'
import recordAgentRunCompleted from './record-agent-run-completed/slice'
import recordAgentRunFailed from './record-agent-run-failed/slice'
import recordAgentRunStarted from './record-agent-run-started/slice'
import recordAgentRunStreamed from './record-agent-run-streamed/slice'
import recordFilesystemNodeChanged from './record-filesystem-node-changed/slice'
import recordFilesystemNodeDeleted from './record-filesystem-node-deleted/slice'
import recordFilesystemNodeDiscovered from './record-filesystem-node-discovered/slice'
import recordToolCallCompleted from './record-tool-call-completed/slice'
import recordToolCallFailed from './record-tool-call-failed/slice'
import recordToolCallStarted from './record-tool-call-started/slice'
import recordVisibleAgentReply from './record-visible-agent-reply/slice'
import recordWorkspaceFilesystemScanCompleted from './record-workspace-filesystem-scan-completed/slice'
import recordWorkspaceFilesystemScanFailed from './record-workspace-filesystem-scan-failed/slice'
import recordWorkspaceFilesystemScanStarted from './record-workspace-filesystem-scan-started/slice'
import replyToPost from './reply-to-post/slice'
import requestAgentRun from './request-agent-run/slice'
import requestWorkspaceFilesystemScan from './request-workspace-filesystem-scan/slice'
import runRequestedAgentRun from './run-requested-agent-run/slice'
import runRequestedFilesystemScan from './run-requested-filesystem-scan/slice'
import workspaceAgentRuns from './workspace-agent-runs/slice'
import workspaceChat from './workspace-chat/slice'
import workspaceList from './workspace-list/slice'
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
  eventLog: sqliteEventLog,
  scheduler: memoryReactionScheduler,
  slices: threadplaneScaffoldRegistrations,
} as const

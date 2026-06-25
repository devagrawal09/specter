import {
  setSpecterSqliteEventProjector,
  sqliteEventLog,
} from '../../db/specter-sqlite'
import { createSqliteReactionScheduler } from '../../db/reaction-queue'
import agentRunTimeline from './agent-run-timeline/slice'
import askQuestion from './ask-question/slice'
import createPost from './create-post/slice'
import createSession from './create-session/slice'
import deleteSession from './delete-session/slice'
import createWorkspace from './create-workspace/slice'
import filesystemTree from './workspace-filesystem-tree/slice'
import filesystemStatus from './workspace-filesystem-status/slice'
import publishAgentRunReply from './publish-agent-run-reply/slice'
import recordAgentRunCompleted from './record-agent-run-completed/slice'
import recordAgentRunFailed from './record-agent-run-failed/slice'
import recordAgentRunStarted from './record-agent-run-started/slice'
import recordAgentRunStreamed from './record-agent-run-streamed/slice'
import recordSessionMessage from './record-session-message/slice'
import recordFilesystemNodeChanged from './record-filesystem-node-changed/slice'
import recordFilesystemNodeDeleted from './record-filesystem-node-deleted/slice'
import recordFilesystemNodeDiscovered from './record-filesystem-node-discovered/slice'
import recordToolCallCompleted from './record-tool-call-completed/slice'
import recordToolCallFailed from './record-tool-call-failed/slice'
import recordToolCallStarted from './record-tool-call-started/slice'
import pendingPermissions from './pending-permissions/slice'
import pendingQuestions from './pending-questions/slice'
import ptySessions from './pty-sessions/slice'
import recordVisibleAgentReply from './record-visible-agent-reply/slice'
import recordWorkspaceFilesystemScanCompleted from './record-workspace-filesystem-scan-completed/slice'
import recordWorkspaceFilesystemScanFailed from './record-workspace-filesystem-scan-failed/slice'
import recordWorkspaceFilesystemScanStarted from './record-workspace-filesystem-scan-started/slice'
import replyToPost from './reply-to-post/slice'
import requestAgentRun from './request-agent-run/slice'
import replyQuestion from './reply-question/slice'
import replyToolApproval from './reply-tool-approval/slice'
import requestToolApproval from './request-tool-approval/slice'
import revertSession from './revert-session/slice'
import requestWorkspaceFilesystemScan from './request-workspace-filesystem-scan/slice'
import runRequestedAgentRun from './run-requested-agent-run/slice'
import runRequestedFilesystemScan from './run-requested-filesystem-scan/slice'
import sessionDetail from './session-detail/slice'
import sessionTranscript from './session-transcript/slice'
import sessionTodos from './session-todos/slice'
import sessionList from './session-list/slice'
import submitPrompt from './submit-prompt/slice'
import updateSession from './update-session/slice'
import updateTodoList from './update-todo-list/slice'
import workspaceAgentRuns from './workspace-agent-runs/slice'
import workspaceChat from './workspace-chat/slice'
import workspaceList from './workspace-list/slice'
import { specterCodeEventDefinitions } from './events'
import { projectSpecterCodeEvent } from './adapters/read-models'

setSpecterSqliteEventProjector(projectSpecterCodeEvent)

export { specterCodeEventDefinitions }

export const specterCodeScaffoldRegistrations = [
  createWorkspace,
  workspaceList,
  createSession,
  updateSession,
  deleteSession,
  sessionList,
  sessionDetail,
  submitPrompt,
  recordSessionMessage,
  sessionTranscript,
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
  requestToolApproval,
  replyToolApproval,
  revertSession,
  pendingPermissions,
  updateTodoList,
  sessionTodos,
  askQuestion,
  replyQuestion,
  pendingQuestions,
  ptySessions,
  workspaceAgentRuns,
  agentRunTimeline,
  runRequestedFilesystemScan,
  runRequestedAgentRun,
  publishAgentRunReply,
] as const

export const specterCodeSliceSkeletons = specterCodeScaffoldRegistrations

export const specterCodeReferenceSpecterAppConfig = {
  events: specterCodeEventDefinitions,
  eventLog: sqliteEventLog,
  schedule: createSqliteReactionScheduler(),
  slices: specterCodeScaffoldRegistrations,
} as const

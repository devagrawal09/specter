import {
  setSpecterSqliteEventProjector,
  sqliteEventLog,
} from '../../db/specter-sqlite'
import { createSqliteReactionScheduler } from '../../db/reaction-queue'
import agentRunTimeline from './agent-run-timeline/impl'
import askQuestion from './ask-question/impl'
import createPost from './create-post/impl'
import createSession from './create-session/impl'
import deleteSession from './delete-session/impl'
import deleteSessionMessage from './delete-session-message/impl'
import deleteSessionMessagePart from './delete-session-message-part/impl'
import forkSession from './fork-session/impl'
import createWorkspace from './create-workspace/impl'
import filesystemTree from './workspace-filesystem-tree/impl'
import filesystemStatus from './workspace-filesystem-status/impl'
import publishAgentRunReply from './publish-agent-run-reply/impl'
import recordAgentRunCompleted from './record-agent-run-completed/impl'
import recordAgentRunFailed from './record-agent-run-failed/impl'
import recordAgentRunStarted from './record-agent-run-started/impl'
import recordAgentRunStreamed from './record-agent-run-streamed/impl'
import recordSessionMessage from './record-session-message/impl'
import recordFilesystemNodeChanged from './record-filesystem-node-changed/impl'
import recordFilesystemNodeDeleted from './record-filesystem-node-deleted/impl'
import recordFilesystemNodeDiscovered from './record-filesystem-node-discovered/impl'
import recordToolCallCompleted from './record-tool-call-completed/impl'
import recordToolCallFailed from './record-tool-call-failed/impl'
import recordToolCallStarted from './record-tool-call-started/impl'
import pendingPermissions from './pending-permissions/impl'
import pendingQuestions from './pending-questions/impl'
import ptySessions from './pty-sessions/impl'
import recordVisibleAgentReply from './record-visible-agent-reply/impl'
import recordWorkspaceFilesystemScanCompleted from './record-workspace-filesystem-scan-completed/impl'
import recordWorkspaceFilesystemScanFailed from './record-workspace-filesystem-scan-failed/impl'
import recordWorkspaceFilesystemScanStarted from './record-workspace-filesystem-scan-started/impl'
import replyToPost from './reply-to-post/impl'
import requestAgentRun from './request-agent-run/impl'
import replyQuestion from './reply-question/impl'
import replyToolApproval from './reply-tool-approval/impl'
import requestToolApproval from './request-tool-approval/impl'
import revertSession from './revert-session/impl'
import requestWorkspaceFilesystemScan from './request-workspace-filesystem-scan/impl'
import runRequestedAgentRun from './run-requested-agent-run/impl'
import runRequestedFilesystemScan from './run-requested-filesystem-scan/impl'
import sessionChildren from './session-children/impl'
import sessionDetail from './session-detail/impl'
import sessionTranscript from './session-transcript/impl'
import sessionTodos from './session-todos/impl'
import sessionList from './session-list/impl'
import submitPrompt from './submit-prompt/impl'
import updateSession from './update-session/impl'
import updateSessionMessagePart from './update-session-message-part/impl'
import updateTodoList from './update-todo-list/impl'
import workspaceAgentRuns from './workspace-agent-runs/impl'
import workspaceChat from './workspace-chat/impl'
import workspaceList from './workspace-list/impl'
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
  forkSession,
  sessionList,
  sessionDetail,
  sessionChildren,
  submitPrompt,
  recordSessionMessage,
  updateSessionMessagePart,
  deleteSessionMessagePart,
  deleteSessionMessage,
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

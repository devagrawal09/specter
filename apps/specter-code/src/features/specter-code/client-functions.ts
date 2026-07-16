import { runSpecterCommand, specterTransport } from '../../specter-transport'

type WithData<T> = { data: T }

type Actor = { userId?: string; displayName: string }

type RequestedBy =
  | ({ type: 'user' } & Actor)
  | { type: 'agent'; agentId: string; displayName: string }
  | { type: 'system' }

export function listSpecterCodeWorkspaces() {
  return specterTransport.query({ type: 'workspaceList', payload: {} })
}

export async function createSpecterCodeWorkspace(
  input: WithData<{ workspaceId: string; scanId: string; name: string }>,
) {
  await runSpecterCommand({ type: 'createWorkspace', payload: input.data })
  return specterTransport.query({ type: 'workspaceList', payload: {} })
}

export function createSpecterCodeSession(
  input: WithData<{
    sessionId: string
    workspaceId: string
    title: string
    directory: string
    agent: string
    model: { providerId: string; modelId: string }
    createdBy?: Actor
  }>,
) {
  return runSpecterCommand({ type: 'createSession', payload: input.data })
}

export function listSpecterCodeSessions(
  input: WithData<{ workspaceId: string }>,
) {
  return specterTransport.query({ type: 'sessionList', payload: input.data })
}

export function submitSpecterCodePrompt(
  input: WithData<{
    messageId: string
    runId: string
    sessionId: string
    workspaceId: string
    content: string
    agentId: string
    agentName: string
    submittedBy: Actor
  }>,
) {
  return runSpecterCommand({ type: 'submitPrompt', payload: input.data })
}

export function listSpecterCodeSessionTranscript(
  input: WithData<{ sessionId: string }>,
) {
  return specterTransport.query({
    type: 'sessionTranscript',
    payload: input.data,
  })
}

export function requestSpecterCodeToolApproval(
  input: WithData<{
    requestId?: string
    sessionId: string
    messageId: string
    workspaceId: string
    agentId: string
    toolCallId?: string
    toolName: string
    permission: string
    target: string
    reason?: string
  }>,
) {
  return runSpecterCommand({
    type: 'requestToolApproval',
    payload: {
      ...input.data,
      requestId: input.data.requestId ?? crypto.randomUUID(),
    },
  })
}

export function replySpecterCodeToolApproval(
  input: WithData<{
    requestId: string
    sessionId: string
    action: 'allow' | 'deny'
    repliedBy?: Actor
    reason?: string
  }>,
) {
  return runSpecterCommand({ type: 'replyToolApproval', payload: input.data })
}

export function listSpecterCodePendingPermissions(
  input: WithData<{ sessionId: string }>,
) {
  return specterTransport.query({
    type: 'pendingPermissions',
    payload: input.data,
  })
}

export function createSpecterCodePost(
  input: WithData<{
    workspaceId: string
    postId: string
    author: Actor
    content: string
  }>,
) {
  return runSpecterCommand({ type: 'createPost', payload: input.data })
}

export function replyToSpecterCodePost(
  input: WithData<{
    workspaceId: string
    replyId: string
    parentPostId: string
    author: Actor
    content: string
  }>,
) {
  return runSpecterCommand({ type: 'replyToPost', payload: input.data })
}

export function listSpecterCodeWorkspaceChat(
  input: WithData<{ workspaceId: string }>,
) {
  return specterTransport.query({ type: 'workspaceChat', payload: input.data })
}

export function requestSpecterCodeFilesystemScan(
  input: WithData<{
    workspaceId: string
    scanId: string
    reason: 'workspaceCreated' | 'userRequested' | 'agentToolChanged'
    requestedBy: RequestedBy
  }>,
) {
  return runSpecterCommand({
    type: 'requestWorkspaceFilesystemScan',
    payload: input.data,
  })
}

export function listSpecterCodeFilesystemTree(
  input: WithData<{ workspaceId: string; parentPath?: string | null }>,
) {
  return specterTransport.query({
    type: 'workspaceFilesystemTree',
    payload: input.data,
  })
}

export function getSpecterCodeFilesystemStatus(
  input: WithData<{ workspaceId: string }>,
) {
  return specterTransport.query({
    type: 'workspaceFilesystemStatus',
    payload: input.data,
  })
}

export function requestSpecterCodeAgentRun(
  input: WithData<{
    workspaceId: string
    runId: string
    postId?: string
    agentId: string
    agentName: string
    requestedBy: RequestedBy
  }>,
) {
  return runSpecterCommand({ type: 'requestAgentRun', payload: input.data })
}

export function listSpecterCodeWorkspaceAgentRuns(
  input: WithData<{ workspaceId: string }>,
) {
  return specterTransport.query({
    type: 'workspaceAgentRuns',
    payload: input.data,
  })
}

export function listSpecterCodeAgentRunTimeline(
  input: WithData<{ workspaceId: string; runId: string }>,
) {
  return specterTransport.query({
    type: 'agentRunTimeline',
    payload: input.data,
  })
}

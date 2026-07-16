import { specterClient } from '../../specter-client'

type WithData<T> = { data: T }

type Actor = { userId?: string; displayName: string }

type RequestedBy =
  | ({ type: 'user' } & Actor)
  | { type: 'agent'; agentId: string; displayName: string }
  | { type: 'system' }

export function listSpecterCodeWorkspaces() {
  return specterClient.workspaceList({})
}

export async function createSpecterCodeWorkspace(
  input: WithData<{ name: string }>,
) {
  await specterClient.createWorkspace({
    name: input.data.name,
    workspaceId: crypto.randomUUID(),
    scanId: crypto.randomUUID(),
  })
  return specterClient.workspaceList({})
}

export function createSpecterCodeSession(
  input: WithData<{
    sessionId?: string
    workspaceId: string
    title: string
    directory: string
    agent: string
    model: { providerId: string; modelId: string }
    createdBy?: Actor
  }>,
) {
  return specterClient.createSession({
    ...input.data,
    sessionId: input.data.sessionId ?? crypto.randomUUID(),
  })
}

export function listSpecterCodeSessions(
  input: WithData<{ workspaceId: string }>,
) {
  return specterClient.sessionList(input.data)
}

export function submitSpecterCodePrompt(
  input: WithData<{
    messageId?: string
    runId?: string
    sessionId: string
    workspaceId: string
    content: string
    agentId: string
    agentName: string
    submittedBy: Actor
  }>,
) {
  return specterClient.submitPrompt({
    ...input.data,
    messageId: input.data.messageId ?? crypto.randomUUID(),
    runId: input.data.runId ?? crypto.randomUUID(),
  })
}

export function listSpecterCodeSessionTranscript(
  input: WithData<{ sessionId: string }>,
) {
  return specterClient.sessionTranscript(input.data)
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
  return specterClient.requestToolApproval({
    ...input.data,
    requestId: input.data.requestId ?? crypto.randomUUID(),
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
  return specterClient.replyToolApproval(input.data)
}

export function listSpecterCodePendingPermissions(
  input: WithData<{ sessionId: string }>,
) {
  return specterClient.pendingPermissions(input.data)
}

export function createSpecterCodePost(
  input: WithData<{
    workspaceId: string
    author: Actor
    content: string
  }>,
) {
  return specterClient.createPost({
    ...input.data,
    postId: crypto.randomUUID(),
  })
}

export function replyToSpecterCodePost(
  input: WithData<{
    workspaceId: string
    parentPostId: string
    author: Actor
    content: string
  }>,
) {
  return specterClient.replyToPost({
    ...input.data,
    replyId: crypto.randomUUID(),
  })
}

export function listSpecterCodeWorkspaceChat(
  input: WithData<{ workspaceId: string }>,
) {
  return specterClient.workspaceChat(input.data)
}

export function requestSpecterCodeFilesystemScan(
  input: WithData<{
    workspaceId: string
    reason: 'workspaceCreated' | 'userRequested' | 'agentToolChanged'
    requestedBy: RequestedBy
  }>,
) {
  return specterClient.requestWorkspaceFilesystemScan({
    ...input.data,
    scanId: crypto.randomUUID(),
  })
}

export function listSpecterCodeFilesystemTree(
  input: WithData<{ workspaceId: string; parentPath?: string | null }>,
) {
  return specterClient.workspaceFilesystemTree(input.data)
}

export function getSpecterCodeFilesystemStatus(
  input: WithData<{ workspaceId: string }>,
) {
  return specterClient.workspaceFilesystemStatus(input.data)
}

export function requestSpecterCodeAgentRun(
  input: WithData<{
    workspaceId: string
    postId?: string
    agentId: string
    agentName: string
    requestedBy: RequestedBy
  }>,
) {
  return specterClient.requestAgentRun({
    ...input.data,
    runId: crypto.randomUUID(),
  })
}

export function listSpecterCodeWorkspaceAgentRuns(
  input: WithData<{ workspaceId: string }>,
) {
  return specterClient.workspaceAgentRuns(input.data)
}

export function listSpecterCodeAgentRunTimeline(
  input: WithData<{ workspaceId: string; runId: string }>,
) {
  return specterClient.agentRunTimeline(input.data)
}

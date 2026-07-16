import { specterClient } from '../../specter-client'

type WithData<T> = { data: T }

export function listThreadplaneWorkspaces() {
  return specterClient.workspaceList({})
}

export async function createThreadplaneWorkspace(
  input: WithData<{ name: string }>,
) {
  await specterClient.createWorkspace({
    name: input.data.name,
    workspaceId: crypto.randomUUID(),
    scanId: crypto.randomUUID(),
  })
  return specterClient.workspaceList({})
}

export function createThreadplanePost(
  input: WithData<{
    workspaceId: string
    author: { userId?: string; displayName: string }
    content: string
  }>,
) {
  return specterClient.createPost({
    ...input.data,
    postId: crypto.randomUUID(),
  })
}

export function replyToThreadplanePost(
  input: WithData<{
    workspaceId: string
    parentPostId: string
    author: { userId?: string; displayName: string }
    content: string
  }>,
) {
  return specterClient.replyToPost({
    ...input.data,
    replyId: crypto.randomUUID(),
  })
}

export function listThreadplaneWorkspaceChat(
  input: WithData<{ workspaceId: string }>,
) {
  return specterClient.workspaceChat(input.data)
}

export function requestThreadplaneFilesystemScan(
  input: WithData<{
    workspaceId: string
    reason: 'workspaceCreated' | 'userRequested' | 'agentToolChanged'
    requestedBy:
      | { type: 'user'; userId?: string; displayName: string }
      | { type: 'agent'; agentId: string; displayName: string }
      | { type: 'system' }
  }>,
) {
  return specterClient.requestWorkspaceFilesystemScan({
    ...input.data,
    scanId: crypto.randomUUID(),
  })
}

export function listThreadplaneFilesystemTree(
  input: WithData<{ workspaceId: string; parentPath?: string | null }>,
) {
  return specterClient.workspaceFilesystemTree(input.data)
}

export function getThreadplaneFilesystemStatus(
  input: WithData<{ workspaceId: string }>,
) {
  return specterClient.workspaceFilesystemStatus(input.data)
}

export function requestThreadplaneAgentRun(
  input: WithData<{
    workspaceId: string
    postId?: string
    agentId: string
    agentName: string
    requestedBy:
      | { type: 'user'; userId?: string; displayName: string }
      | { type: 'agent'; agentId: string; displayName: string }
      | { type: 'system' }
  }>,
) {
  return specterClient.requestAgentRun({
    ...input.data,
    runId: crypto.randomUUID(),
  })
}

export function listThreadplaneWorkspaceAgentRuns(
  input: WithData<{ workspaceId: string }>,
) {
  return specterClient.workspaceAgentRuns(input.data)
}

export function listThreadplaneAgentRunTimeline(
  input: WithData<{ workspaceId: string; runId: string }>,
) {
  return specterClient.agentRunTimeline(input.data)
}

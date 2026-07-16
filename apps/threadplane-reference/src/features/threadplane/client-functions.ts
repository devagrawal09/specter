import { runSpecterCommand, specterTransport } from '../../specter-transport'

type WithData<T> = { data: T }

export function listThreadplaneWorkspaces() {
  return specterTransport.query({ type: 'workspaceList', payload: {} })
}

export async function createThreadplaneWorkspace(
  input: WithData<{ workspaceId: string; scanId: string; name: string }>,
) {
  await runSpecterCommand({ type: 'createWorkspace', payload: input.data })
  return specterTransport.query({ type: 'workspaceList', payload: {} })
}

export function createThreadplanePost(
  input: WithData<{
    workspaceId: string
    postId: string
    author: { userId?: string; displayName: string }
    content: string
  }>,
) {
  return runSpecterCommand({ type: 'createPost', payload: input.data })
}

export function replyToThreadplanePost(
  input: WithData<{
    workspaceId: string
    replyId: string
    parentPostId: string
    author: { userId?: string; displayName: string }
    content: string
  }>,
) {
  return runSpecterCommand({ type: 'replyToPost', payload: input.data })
}

export function listThreadplaneWorkspaceChat(
  input: WithData<{ workspaceId: string }>,
) {
  return specterTransport.query({ type: 'workspaceChat', payload: input.data })
}

export function requestThreadplaneFilesystemScan(
  input: WithData<{
    workspaceId: string
    scanId: string
    reason: 'workspaceCreated' | 'userRequested' | 'agentToolChanged'
    requestedBy:
      | { type: 'user'; userId?: string; displayName: string }
      | { type: 'agent'; agentId: string; displayName: string }
      | { type: 'system' }
  }>,
) {
  return runSpecterCommand({
    type: 'requestWorkspaceFilesystemScan',
    payload: input.data,
  })
}

export function listThreadplaneFilesystemTree(
  input: WithData<{ workspaceId: string; parentPath?: string | null }>,
) {
  return specterTransport.query({
    type: 'workspaceFilesystemTree',
    payload: input.data,
  })
}

export function getThreadplaneFilesystemStatus(
  input: WithData<{ workspaceId: string }>,
) {
  return specterTransport.query({
    type: 'workspaceFilesystemStatus',
    payload: input.data,
  })
}

export function requestThreadplaneAgentRun(
  input: WithData<{
    workspaceId: string
    runId: string
    postId?: string
    agentId: string
    agentName: string
    requestedBy:
      | { type: 'user'; userId?: string; displayName: string }
      | { type: 'agent'; agentId: string; displayName: string }
      | { type: 'system' }
  }>,
) {
  return runSpecterCommand({ type: 'requestAgentRun', payload: input.data })
}

export function listThreadplaneWorkspaceAgentRuns(
  input: WithData<{ workspaceId: string }>,
) {
  return specterTransport.query({
    type: 'workspaceAgentRuns',
    payload: input.data,
  })
}

export function listThreadplaneAgentRunTimeline(
  input: WithData<{ workspaceId: string; runId: string }>,
) {
  return specterTransport.query({
    type: 'agentRunTimeline',
    payload: input.data,
  })
}

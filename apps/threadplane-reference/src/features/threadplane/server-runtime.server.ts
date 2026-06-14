import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { createSpecterApp } from '@specter-ts/core'

import { runWithThreadplaneReferenceDb } from '../../db/client.server'
import { threadplaneReferenceSpecterAppConfig } from './registry'

const app = createSpecterApp(threadplaneReferenceSpecterAppConfig)

const normalizeRelativePath = (input: string) => {
  const normalized = path.posix.normalize(input.replaceAll('\\', '/'))
  if (
    !normalized ||
    normalized === '.' ||
    normalized.startsWith('..') ||
    path.isAbsolute(normalized)
  ) {
    throw new Error('File path must be relative and normalized')
  }
  return normalized
}

const resolvePreviewPath = (workspaceId: string, filePath: string) => {
  const baseRoot =
    process.env.THREADPLANE_WORKSPACE_ROOT ??
    path.join(process.cwd(), 'data', 'threadplane-workspaces')
  const resolved = path.resolve(
    baseRoot,
    workspaceId,
    normalizeRelativePath(filePath),
  )
  const workspaceRoot = path.resolve(baseRoot, workspaceId)
  if (
    resolved !== workspaceRoot &&
    !resolved.startsWith(`${workspaceRoot}${path.sep}`)
  ) {
    throw new Error('File path escapes workspace root')
  }
  return resolved
}

export async function listThreadplaneWorkspacesOnServer() {
  return runWithThreadplaneReferenceDb(async () => app.workspaceList({}))
}

export async function createThreadplaneWorkspaceOnServer(data: {
  name: string
}) {
  return runWithThreadplaneReferenceDb(async () => {
    await app.createWorkspace({ name: data.name })
    return app.workspaceList({})
  })
}

export async function createThreadplanePostOnServer(data: {
  workspaceId: string
  author: { userId?: string; displayName: string }
  content: string
}) {
  return runWithThreadplaneReferenceDb(() => app.createPost(data))
}

export async function replyToThreadplanePostOnServer(data: {
  workspaceId: string
  parentPostId: string
  author: { userId?: string; displayName: string }
  content: string
}) {
  return runWithThreadplaneReferenceDb(() => app.replyToPost(data))
}

export async function listThreadplaneWorkspaceChatOnServer(data: {
  workspaceId: string
}) {
  return runWithThreadplaneReferenceDb(() => app.workspaceChat(data))
}

export async function requestThreadplaneFilesystemScanOnServer(data: {
  workspaceId: string
  reason: 'workspaceCreated' | 'userRequested' | 'agentToolChanged'
  requestedBy:
    | { type: 'user'; userId?: string; displayName: string }
    | { type: 'agent'; agentId: string; displayName: string }
    | { type: 'system' }
}) {
  return runWithThreadplaneReferenceDb(() =>
    app.requestWorkspaceFilesystemScan(data),
  )
}

export async function listThreadplaneFilesystemTreeOnServer(data: {
  workspaceId: string
  parentPath?: string | null
}) {
  return runWithThreadplaneReferenceDb(() => app.workspaceFilesystemTree(data))
}

export async function getThreadplaneFilesystemStatusOnServer(data: {
  workspaceId: string
}) {
  return runWithThreadplaneReferenceDb(() =>
    app.workspaceFilesystemStatus(data),
  )
}

export async function requestThreadplaneAgentRunOnServer(data: {
  workspaceId: string
  postId?: string
  agentId: string
  agentName: string
  requestedBy:
    | { type: 'user'; userId?: string; displayName: string }
    | { type: 'agent'; agentId: string; displayName: string }
    | { type: 'system' }
}) {
  return runWithThreadplaneReferenceDb(() => app.requestAgentRun(data))
}

export async function listThreadplaneWorkspaceAgentRunsOnServer(data: {
  workspaceId: string
}) {
  return runWithThreadplaneReferenceDb(() => app.workspaceAgentRuns(data))
}

export async function listThreadplaneAgentRunTimelineOnServer(data: {
  workspaceId: string
  runId: string
}) {
  return runWithThreadplaneReferenceDb(() => app.agentRunTimeline(data))
}

export async function readThreadplaneWorkspaceTextFileOnServer(data: {
  workspaceId: string
  path: string
}) {
  const resolvedPath = resolvePreviewPath(data.workspaceId, data.path)
  return readFile(resolvedPath, 'utf8')
}

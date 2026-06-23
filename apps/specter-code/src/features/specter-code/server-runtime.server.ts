import { lstat, readFile } from 'node:fs/promises'
import path from 'node:path'

import { createSpecterApp } from '@specter-ts/core'

import { runWithSpecterCodeReferenceDb } from '../../db/client.server'
import { specterCodeReferenceSpecterAppConfig } from './registry'

const app = createSpecterApp(specterCodeReferenceSpecterAppConfig)

const SPECTER_CODE_PREVIEW_MAX_BYTES = 256 * 1024

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

const normalizeWorkspaceId = (input: string) => {
  const normalized = path.posix.normalize(input.replaceAll('\\', '/'))
  if (
    !normalized ||
    normalized === '.' ||
    normalized.startsWith('..') ||
    path.isAbsolute(normalized)
  ) {
    throw new Error('Workspace id must be relative and normalized')
  }
  return normalized
}

const resolvePreviewPath = (workspaceId: string, filePath: string) => {
  const baseRoot =
    process.env.SPECTER_CODE_WORKSPACE_ROOT ??
    path.join(process.cwd(), 'data', 'specter-code-workspaces')
  const safeWorkspaceId = normalizeWorkspaceId(workspaceId)
  const resolved = path.resolve(
    baseRoot,
    safeWorkspaceId,
    normalizeRelativePath(filePath),
  )
  const workspaceRoot = path.resolve(baseRoot, safeWorkspaceId)
  if (
    resolved !== workspaceRoot &&
    !resolved.startsWith(`${workspaceRoot}${path.sep}`)
  ) {
    throw new Error('File path escapes workspace root')
  }
  return resolved
}

export async function listSpecterCodeWorkspacesOnServer() {
  return runWithSpecterCodeReferenceDb(async () => app.workspaceList({}))
}

export async function createSpecterCodeWorkspaceOnServer(data: {
  name: string
}) {
  return runWithSpecterCodeReferenceDb(async () => {
    await app.createWorkspace({ name: data.name })
    return app.workspaceList({})
  })
}

export async function createSpecterCodePostOnServer(data: {
  workspaceId: string
  author: { userId?: string; displayName: string }
  content: string
}) {
  return runWithSpecterCodeReferenceDb(() => app.createPost(data))
}

export async function replyToSpecterCodePostOnServer(data: {
  workspaceId: string
  parentPostId: string
  author: { userId?: string; displayName: string }
  content: string
}) {
  return runWithSpecterCodeReferenceDb(() => app.replyToPost(data))
}

export async function listSpecterCodeWorkspaceChatOnServer(data: {
  workspaceId: string
}) {
  return runWithSpecterCodeReferenceDb(() => app.workspaceChat(data))
}

export async function createSpecterCodeSessionOnServer(data: {
  sessionId?: string
  workspaceId: string
  title: string
  directory: string
  agent: string
  model: { providerId: string; modelId: string }
  createdBy?: { userId?: string; displayName: string }
}) {
  return runWithSpecterCodeReferenceDb(() => app.createSession(data))
}

export async function listSpecterCodeSessionsOnServer(data: {
  workspaceId: string
}) {
  return runWithSpecterCodeReferenceDb(() => app.sessionList(data))
}

export async function submitSpecterCodePromptOnServer(data: {
  messageId?: string
  runId?: string
  sessionId: string
  workspaceId: string
  content: string
  agentId: string
  agentName: string
  submittedBy: { userId?: string; displayName: string }
}) {
  return runWithSpecterCodeReferenceDb(() => app.submitPrompt(data))
}

export async function listSpecterCodeSessionTranscriptOnServer(data: {
  sessionId: string
}) {
  return runWithSpecterCodeReferenceDb(() => app.sessionTranscript(data))
}

export async function requestSpecterCodeFilesystemScanOnServer(data: {
  workspaceId: string
  reason: 'workspaceCreated' | 'userRequested' | 'agentToolChanged'
  requestedBy:
    | { type: 'user'; userId?: string; displayName: string }
    | { type: 'agent'; agentId: string; displayName: string }
    | { type: 'system' }
}) {
  return runWithSpecterCodeReferenceDb(() =>
    app.requestWorkspaceFilesystemScan(data),
  )
}

export async function listSpecterCodeFilesystemTreeOnServer(data: {
  workspaceId: string
  parentPath?: string | null
}) {
  return runWithSpecterCodeReferenceDb(() => app.workspaceFilesystemTree(data))
}

export async function getSpecterCodeFilesystemStatusOnServer(data: {
  workspaceId: string
}) {
  return runWithSpecterCodeReferenceDb(() =>
    app.workspaceFilesystemStatus(data),
  )
}

export async function requestSpecterCodeAgentRunOnServer(data: {
  workspaceId: string
  postId?: string
  agentId: string
  agentName: string
  requestedBy:
    | { type: 'user'; userId?: string; displayName: string }
    | { type: 'agent'; agentId: string; displayName: string }
    | { type: 'system' }
}) {
  return runWithSpecterCodeReferenceDb(() => app.requestAgentRun(data))
}

export async function listSpecterCodeWorkspaceAgentRunsOnServer(data: {
  workspaceId: string
}) {
  return runWithSpecterCodeReferenceDb(() => app.workspaceAgentRuns(data))
}

export async function listSpecterCodeAgentRunTimelineOnServer(data: {
  workspaceId: string
  runId: string
}) {
  return runWithSpecterCodeReferenceDb(() => app.agentRunTimeline(data))
}

export async function readSpecterCodeWorkspaceTextFileOnServer(data: {
  workspaceId: string
  path: string
}) {
  const resolvedPath = resolvePreviewPath(data.workspaceId, data.path)
  const fileStat = await lstat(resolvedPath)
  if (fileStat.isSymbolicLink())
    throw new Error('Preview file must not be a symlink')
  if (!fileStat.isFile()) throw new Error('Preview path must be a file')
  if (fileStat.size > SPECTER_CODE_PREVIEW_MAX_BYTES)
    throw new Error('Preview file exceeds maximum size')

  const fileBytes = await readFile(resolvedPath)
  if (fileBytes.includes(0))
    throw new Error('Preview file appears to be binary')

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(fileBytes)
  } catch {
    throw new Error('Preview file is not valid UTF-8 text')
  }
}

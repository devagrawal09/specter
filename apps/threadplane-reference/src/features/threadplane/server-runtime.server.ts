import { lstat, readFile } from 'node:fs/promises'
import path from 'node:path'

import { createSpecterApp, type SpecterCommandEnvelope } from '@specter-ts/core'

import {
  prepareThreadplaneReferenceDb,
  runWithThreadplaneReferenceDb,
  threadplaneProductionReactionScheduler,
  threadplaneReactionTickets,
} from '../../db/client.server'
import { createSpecterHttpHandler } from '../../transport/specter-http.server'
import { createThreadplaneReferenceSpecterAppConfig } from './registry'
import { threadplaneMemoryStoresLayer } from '../../testing/memory-slice-store'

await prepareThreadplaneReferenceDb()
const threadplaneReferenceSpecterAppConfig =
  createThreadplaneReferenceSpecterAppConfig(
    threadplaneProductionReactionScheduler,
  )
const app = await createSpecterApp(
  threadplaneReferenceSpecterAppConfig,
  threadplaneMemoryStoresLayer(),
)

async function runSpecterCommand(
  envelope: SpecterCommandEnvelope<typeof threadplaneReferenceSpecterAppConfig>,
) {
  const execution = await app.command(envelope)
  await execution.reactions
}

export const handleThreadplaneSpecterRequest = createSpecterHttpHandler({
  app,
  basePath: '/api/specter',
  run: runWithThreadplaneReferenceDb,
  reactionTickets: threadplaneReactionTickets,
})

const THREADPLANE_PREVIEW_MAX_BYTES = 256 * 1024

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
    process.env.THREADPLANE_WORKSPACE_ROOT ??
    path.join(process.cwd(), 'data', 'threadplane-workspaces')
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

export async function listThreadplaneWorkspacesOnServer() {
  return runWithThreadplaneReferenceDb(async () =>
    app.query({ type: 'workspaceList', payload: {} }),
  )
}

export async function createThreadplaneWorkspaceOnServer(data: {
  workspaceId: string
  scanId: string
  name: string
}) {
  return runWithThreadplaneReferenceDb(async () => {
    await runSpecterCommand({ type: 'createWorkspace', payload: data })
    return app.query({ type: 'workspaceList', payload: {} })
  })
}

export async function createThreadplanePostOnServer(data: {
  workspaceId: string
  postId: string
  author: { userId?: string; displayName: string }
  content: string
}) {
  return runWithThreadplaneReferenceDb(() =>
    runSpecterCommand({ type: 'createPost', payload: data }),
  )
}

export async function replyToThreadplanePostOnServer(data: {
  workspaceId: string
  replyId: string
  parentPostId: string
  author: { userId?: string; displayName: string }
  content: string
}) {
  return runWithThreadplaneReferenceDb(() =>
    runSpecterCommand({ type: 'replyToPost', payload: data }),
  )
}

export async function listThreadplaneWorkspaceChatOnServer(data: {
  workspaceId: string
}) {
  return runWithThreadplaneReferenceDb(() =>
    app.query({ type: 'workspaceChat', payload: data }),
  )
}

export async function requestThreadplaneFilesystemScanOnServer(data: {
  workspaceId: string
  scanId: string
  reason: 'workspaceCreated' | 'userRequested' | 'agentToolChanged'
  requestedBy:
    | { type: 'user'; userId?: string; displayName: string }
    | { type: 'agent'; agentId: string; displayName: string }
    | { type: 'system' }
}) {
  return runWithThreadplaneReferenceDb(() =>
    runSpecterCommand({
      type: 'requestWorkspaceFilesystemScan',
      payload: data,
    }),
  )
}

export async function listThreadplaneFilesystemTreeOnServer(data: {
  workspaceId: string
  parentPath?: string | null
}) {
  return runWithThreadplaneReferenceDb(() =>
    app.query({ type: 'workspaceFilesystemTree', payload: data }),
  )
}

export async function getThreadplaneFilesystemStatusOnServer(data: {
  workspaceId: string
}) {
  return runWithThreadplaneReferenceDb(() =>
    app.query({ type: 'workspaceFilesystemStatus', payload: data }),
  )
}

export async function requestThreadplaneAgentRunOnServer(data: {
  workspaceId: string
  runId: string
  postId?: string
  agentId: string
  agentName: string
  requestedBy:
    | { type: 'user'; userId?: string; displayName: string }
    | { type: 'agent'; agentId: string; displayName: string }
    | { type: 'system' }
}) {
  return runWithThreadplaneReferenceDb(() =>
    runSpecterCommand({ type: 'requestAgentRun', payload: data }),
  )
}

export async function listThreadplaneWorkspaceAgentRunsOnServer(data: {
  workspaceId: string
}) {
  return runWithThreadplaneReferenceDb(() =>
    app.query({ type: 'workspaceAgentRuns', payload: data }),
  )
}

export async function listThreadplaneAgentRunTimelineOnServer(data: {
  workspaceId: string
  runId: string
}) {
  return runWithThreadplaneReferenceDb(() =>
    app.query({ type: 'agentRunTimeline', payload: data }),
  )
}

export async function readThreadplaneWorkspaceTextFileOnServer(data: {
  workspaceId: string
  path: string
}) {
  const resolvedPath = resolvePreviewPath(data.workspaceId, data.path)
  const fileStat = await lstat(resolvedPath)
  if (fileStat.isSymbolicLink())
    throw new Error('Preview file must not be a symlink')
  if (!fileStat.isFile()) throw new Error('Preview path must be a file')
  if (fileStat.size > THREADPLANE_PREVIEW_MAX_BYTES)
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

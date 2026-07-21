import { lstat, readFile } from 'node:fs/promises'
import path from 'node:path'

import { createSpecterApp, type SpecterCommandEnvelope } from '@specter-ts/core'

import {
  prepareSpecterCodeReferenceDb,
  runWithSpecterCodeReferenceDb,
  specterCodeProductionReactionScheduler,
  specterCodeReactionTickets,
} from '../../db/client.server'
import { querySpecterSqliteEvents } from '../../db/specter-sqlite'
import { createSpecterHttpHandler } from '../../transport/specter-http.server'
import { createSpecterCodeReferenceSpecterAppConfig } from './registry'
import { specterCodeMemoryStoresLayer } from '../../testing/memory-slice-store'

await prepareSpecterCodeReferenceDb()
const specterCodeReferenceSpecterAppConfig =
  createSpecterCodeReferenceSpecterAppConfig(
    specterCodeProductionReactionScheduler,
  )
const app = await createSpecterApp(
  specterCodeReferenceSpecterAppConfig,
  specterCodeMemoryStoresLayer(),
)

async function runSpecterCommand(
  envelope: SpecterCommandEnvelope<typeof specterCodeReferenceSpecterAppConfig>,
) {
  const execution = await app.command(envelope)
  await execution.reactions
}

export const handleSpecterCodeSpecterRequest = createSpecterHttpHandler({
  app,
  basePath: '/api/specter',
  run: runWithSpecterCodeReferenceDb,
  reactionTickets: specterCodeReactionTickets,
})

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

const resolveWorkspaceRoot = (workspaceId: string) => {
  const baseRoot =
    process.env.SPECTER_CODE_WORKSPACE_ROOT ??
    path.join(process.cwd(), 'data', 'specter-code-workspaces')
  const safeWorkspaceId = normalizeWorkspaceId(workspaceId)
  const workspaceRoot = path.resolve(baseRoot, safeWorkspaceId)
  const resolvedBaseRoot = path.resolve(baseRoot)
  if (
    workspaceRoot !== resolvedBaseRoot &&
    !workspaceRoot.startsWith(`${resolvedBaseRoot}${path.sep}`)
  ) {
    throw new Error('Workspace root escapes base directory')
  }
  return workspaceRoot
}

const resolvePreviewPath = (workspaceId: string, filePath: string) => {
  const workspaceRoot = resolveWorkspaceRoot(workspaceId)
  const resolved = path.resolve(workspaceRoot, normalizeRelativePath(filePath))
  if (
    resolved !== workspaceRoot &&
    !resolved.startsWith(`${workspaceRoot}${path.sep}`)
  ) {
    throw new Error('File path escapes workspace root')
  }
  return resolved
}

export async function listSpecterCodeWorkspacesOnServer() {
  return runWithSpecterCodeReferenceDb(async () =>
    app.query({ type: 'workspaceList', payload: {} }),
  )
}

export async function createSpecterCodeWorkspaceOnServer(data: {
  workspaceId: string
  scanId: string
  name: string
}) {
  return runWithSpecterCodeReferenceDb(async () => {
    await runSpecterCommand({ type: 'createWorkspace', payload: data })
    return app.query({ type: 'workspaceList', payload: {} })
  })
}

export async function createSpecterCodePostOnServer(data: {
  workspaceId: string
  postId: string
  author: { userId?: string; displayName: string }
  content: string
}) {
  return runWithSpecterCodeReferenceDb(() =>
    runSpecterCommand({ type: 'createPost', payload: data }),
  )
}

export async function replyToSpecterCodePostOnServer(data: {
  workspaceId: string
  replyId: string
  parentPostId: string
  author: { userId?: string; displayName: string }
  content: string
}) {
  return runWithSpecterCodeReferenceDb(() =>
    runSpecterCommand({ type: 'replyToPost', payload: data }),
  )
}

export async function listSpecterCodeWorkspaceChatOnServer(data: {
  workspaceId: string
}) {
  return runWithSpecterCodeReferenceDb(() =>
    app.query({ type: 'workspaceChat', payload: data }),
  )
}

export async function createSpecterCodeSessionOnServer(data: {
  sessionId: string
  workspaceId: string
  title: string
  directory: string
  agent: string
  model: { providerId: string; modelId: string }
  createdBy?: { userId?: string; displayName: string }
}) {
  return runWithSpecterCodeReferenceDb(() =>
    runSpecterCommand({ type: 'createSession', payload: data }),
  )
}

export async function listSpecterCodeSessionsOnServer(data: {
  workspaceId: string
}) {
  return runWithSpecterCodeReferenceDb(() =>
    app.query({ type: 'sessionList', payload: data }),
  )
}

export async function getSpecterCodeSessionOnServer(data: {
  sessionId: string
}) {
  return runWithSpecterCodeReferenceDb(() =>
    app.query({ type: 'sessionDetail', payload: data }),
  )
}

export async function forkSpecterCodeSessionOnServer(data: {
  sessionId: string
  newSessionId: string
  workspaceId: string
  title: string
  directory: string
  agent: string
  model: { providerId: string; modelId: string }
  createdBy?: { userId?: string; displayName: string }
}) {
  await runWithSpecterCodeReferenceDb(() =>
    runSpecterCommand({ type: 'forkSession', payload: data }),
  )
  return getSpecterCodeSessionOnServer({ sessionId: data.newSessionId })
}

export async function listSpecterCodeSessionChildrenOnServer(data: {
  sessionId: string
}) {
  return runWithSpecterCodeReferenceDb(() =>
    app.query({ type: 'sessionChildren', payload: data }),
  )
}

export async function updateSpecterCodeSessionOnServer(data: {
  sessionId: string
  title?: string
  directory?: string
  agent?: string
  model?: { providerId: string; modelId: string }
  updatedBy?: { userId?: string; displayName: string }
}) {
  await runWithSpecterCodeReferenceDb(() =>
    runSpecterCommand({ type: 'updateSession', payload: data }),
  )
  return getSpecterCodeSessionOnServer({ sessionId: data.sessionId })
}

export async function deleteSpecterCodeSessionOnServer(data: {
  sessionId: string
  deletedBy?: { userId?: string; displayName: string }
}) {
  await runWithSpecterCodeReferenceDb(() =>
    runSpecterCommand({ type: 'deleteSession', payload: data }),
  )
  return true
}

export async function submitSpecterCodePromptOnServer(data: {
  messageId: string
  runId: string
  sessionId: string
  workspaceId: string
  content: string
  agentId: string
  agentName: string
  submittedBy: { userId?: string; displayName: string }
}) {
  return runWithSpecterCodeReferenceDb(() =>
    runSpecterCommand({ type: 'submitPrompt', payload: data }),
  )
}

export async function recordSpecterCodeSessionMessageOnServer(data: {
  messageId?: string
  sessionId: string
  workspaceId: string
  content: string
  submittedBy: { userId?: string; displayName: string }
}) {
  return runWithSpecterCodeReferenceDb(() =>
    runSpecterCommand({
      type: 'recordSessionMessage',
      payload: {
        ...data,
        messageId: data.messageId ?? crypto.randomUUID(),
      },
    }),
  )
}

export async function listSpecterCodeSessionTranscriptOnServer(data: {
  sessionId: string
}) {
  return runWithSpecterCodeReferenceDb(() =>
    app.query({ type: 'sessionTranscript', payload: data }),
  )
}

export async function getSpecterCodeSessionMessageOnServer(data: {
  sessionId: string
  messageId: string
}) {
  return runWithSpecterCodeReferenceDb(async () => {
    const transcript = await app.query({
      type: 'sessionTranscript',
      payload: {
        sessionId: data.sessionId,
      },
    })
    const message = transcript.find((item) => item.id === data.messageId)
    if (!message)
      throw new Error(`Session message not found: ${data.messageId}`)
    return message
  })
}

export async function updateSpecterCodeSessionMessagePartOnServer(data: {
  sessionId: string
  messageId: string
  partId: string
  text: string
}) {
  return runWithSpecterCodeReferenceDb(async () => {
    await runSpecterCommand({ type: 'updateSessionMessagePart', payload: data })
    const transcript = await app.query({
      type: 'sessionTranscript',
      payload: {
        sessionId: data.sessionId,
      },
    })
    const message = transcript.find((item) => item.id === data.messageId)
    if (!message)
      throw new Error(`Session message not found: ${data.messageId}`)
    return message
  })
}

export async function deleteSpecterCodeSessionMessagePartOnServer(data: {
  sessionId: string
  messageId: string
  partId: string
}) {
  return runWithSpecterCodeReferenceDb(async () => {
    await runSpecterCommand({ type: 'deleteSessionMessagePart', payload: data })
    const transcript = await app.query({
      type: 'sessionTranscript',
      payload: {
        sessionId: data.sessionId,
      },
    })
    const message = transcript.find((item) => item.id === data.messageId)
    if (!message)
      throw new Error(`Session message not found: ${data.messageId}`)
    return message
  })
}

export async function deleteSpecterCodeSessionMessageOnServer(data: {
  sessionId: string
  messageId: string
}) {
  return runWithSpecterCodeReferenceDb(async () => {
    await runSpecterCommand({ type: 'deleteSessionMessage', payload: data })
    return true
  })
}

export async function requestSpecterCodeFilesystemScanOnServer(data: {
  workspaceId: string
  scanId: string
  reason: 'workspaceCreated' | 'userRequested' | 'agentToolChanged'
  requestedBy:
    | { type: 'user'; userId?: string; displayName: string }
    | { type: 'agent'; agentId: string; displayName: string }
    | { type: 'system' }
}) {
  return runWithSpecterCodeReferenceDb(() =>
    runSpecterCommand({
      type: 'requestWorkspaceFilesystemScan',
      payload: data,
    }),
  )
}

export async function listSpecterCodeFilesystemTreeOnServer(data: {
  workspaceId: string
  parentPath?: string | null
}) {
  return runWithSpecterCodeReferenceDb(() =>
    app.query({ type: 'workspaceFilesystemTree', payload: data }),
  )
}

export async function getSpecterCodeFilesystemStatusOnServer(data: {
  workspaceId: string
}) {
  return runWithSpecterCodeReferenceDb(() =>
    app.query({ type: 'workspaceFilesystemStatus', payload: data }),
  )
}

export async function getSpecterCodeWorkspaceDiffOnServer(data: {
  workspaceId: string
}) {
  const { getGitDiff, getGitStatus } = await import('./adapters/git')
  const workspaceRoot = resolveWorkspaceRoot(data.workspaceId)
  const [status, diff] = await Promise.all([
    getGitStatus({ workspaceRoot }),
    getGitDiff({ workspaceRoot }),
  ])
  return { workspaceRoot, status, diff }
}

export async function revertSpecterCodeWorkspaceChangesOnServer(data: {
  workspaceId: string
  paths: string[]
}) {
  const { revertWorkspacePaths } = await import('./adapters/git')
  return revertWorkspacePaths({
    workspaceRoot: resolveWorkspaceRoot(data.workspaceId),
    paths: data.paths,
  })
}

export async function requestSpecterCodeAgentRunOnServer(data: {
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
  return runWithSpecterCodeReferenceDb(() =>
    runSpecterCommand({ type: 'requestAgentRun', payload: data }),
  )
}

export async function listSpecterCodeWorkspaceAgentRunsOnServer(data: {
  workspaceId: string
}) {
  return runWithSpecterCodeReferenceDb(() =>
    app.query({ type: 'workspaceAgentRuns', payload: data }),
  )
}

export async function listSpecterCodeAgentRunTimelineOnServer(data: {
  workspaceId: string
  runId: string
}) {
  return runWithSpecterCodeReferenceDb(() =>
    app.query({ type: 'agentRunTimeline', payload: data }),
  )
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

export async function requestSpecterCodeToolApprovalOnServer(data: {
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
}) {
  return runWithSpecterCodeReferenceDb(() =>
    runSpecterCommand({
      type: 'requestToolApproval',
      payload: {
        ...data,
        requestId: data.requestId ?? crypto.randomUUID(),
      },
    }),
  )
}

export async function replySpecterCodeToolApprovalOnServer(data: {
  requestId: string
  sessionId: string
  action: 'allow' | 'deny'
  repliedBy?: { userId?: string; displayName: string }
  reason?: string
}) {
  return runWithSpecterCodeReferenceDb(() =>
    runSpecterCommand({ type: 'replyToolApproval', payload: data }),
  )
}

export async function listSpecterCodePendingPermissionsOnServer(data: {
  sessionId: string
}) {
  return runWithSpecterCodeReferenceDb(() =>
    app.query({ type: 'pendingPermissions', payload: data }),
  )
}

export async function getSpecterCodeSettingsOnServer() {
  const [
    { loadSpecterCodeConfig },
    { createProviderRegistry },
    { createAgentRegistry },
  ] = await Promise.all([
    import('./adapters/config-loader'),
    import('./adapters/llm-provider'),
    import('./adapters/agent-registry'),
  ])
  const config = await loadSpecterCodeConfig({ workspaceRoot: process.cwd() })
  const providerRegistry = createProviderRegistry({ config })
  const agentRegistry = createAgentRegistry({ config })

  const agents = agentRegistry
    .listAgents()
    .map(({ options: _options, ...agent }) => agent)
  const { options: _defaultOptions, ...defaultAgent } =
    agentRegistry.resolveDefaultAgent()

  return {
    sources: config.sources,
    defaultModel: providerRegistry.resolveDefaultModel(),
    providers: providerRegistry.listProviders(),
    defaultAgent,
    agents,
  }
}

export async function updateSpecterCodeTodoListOnServer(data: {
  sessionId: string
  messageId: string
  items: Array<{
    id?: string
    content: string
    status: 'pending' | 'in_progress' | 'completed'
    priority?: 'low' | 'medium' | 'high'
  }>
}) {
  return runWithSpecterCodeReferenceDb(() =>
    runSpecterCommand({
      type: 'updateTodoList',
      payload: {
        ...data,
        items: data.items.map((item) => ({
          ...item,
          id: item.id ?? crypto.randomUUID(),
        })),
      },
    }),
  )
}

export async function listSpecterCodeSessionTodosOnServer(data: {
  sessionId: string
}) {
  return runWithSpecterCodeReferenceDb(() =>
    app.query({ type: 'sessionTodos', payload: data }),
  )
}

export async function askSpecterCodeQuestionOnServer(data: {
  questionId?: string
  sessionId: string
  messageId: string
  prompt: string
  options?: Array<{ id?: string; label: string }>
  allowFreeform?: boolean
}) {
  return runWithSpecterCodeReferenceDb(() =>
    runSpecterCommand({
      type: 'askQuestion',
      payload: {
        ...data,
        questionId: data.questionId ?? crypto.randomUUID(),
        options: data.options?.map((option) => ({
          ...option,
          id: option.id ?? crypto.randomUUID(),
        })),
      },
    }),
  )
}

export async function replySpecterCodeQuestionOnServer(data: {
  questionId: string
  sessionId: string
  answer: string
  answeredBy?: { userId?: string; displayName: string }
}) {
  return runWithSpecterCodeReferenceDb(() =>
    runSpecterCommand({ type: 'replyQuestion', payload: data }),
  )
}

export async function listSpecterCodePendingQuestionsOnServer(data: {
  sessionId?: string
}) {
  return runWithSpecterCodeReferenceDb(() =>
    app.query({ type: 'pendingQuestions', payload: data }),
  )
}

export async function listSpecterCodeEventsOnServer(data: {
  afterOrder?: number
}) {
  return runWithSpecterCodeReferenceDb(() =>
    querySpecterSqliteEvents({ afterOrder: data.afterOrder }),
  )
}

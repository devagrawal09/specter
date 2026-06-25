import { randomUUID } from 'node:crypto'

import { createAgentRegistry, type AgentSummary } from './adapters/agent-registry'
import { loadSpecterCodeConfig, type SpecterCodeConfig } from './adapters/config-loader'
import { createSpecterCodeEventStream, type SpecterCodeStreamEvent } from './adapters/event-stream'
import { findWorkspaceFiles, findWorkspaceText, type OpenCodeTextMatch } from './adapters/find'
import { applyGitPatch, getGitDiff, getGitStatus, type GitDiff, type GitStatus } from './adapters/git'
import { createProviderRegistry, type ProviderSummary } from './adapters/llm-provider'
import { createPtySessionManager, type PtySession } from './adapters/pty'
import {
  collectTypeScriptDiagnostics,
  findWorkspaceSymbols,
  type LspDiagnostic,
  type LspSymbol,
} from './adapters/lsp'
import { listSpecterCodeSkills, type SpecterCodeSkillInfo } from './adapters/skills'
import type { RouteSpec } from './domain/openapi-compat'

export type JsonRecord = Record<string, unknown>

export type PtyShellSummary = {
  path: string
  name: string
  acceptable: boolean
}

export type PtySize = { rows: number; cols: number }
export type ApiPtySession = PtySession & { title?: string; size?: PtySize }

export type SpecterCodeApiRuntime = {
  listSessions(input: { workspaceId: string }): Promise<unknown>
  createSession(input: {
    sessionId?: string
    workspaceId: string
    title: string
    directory: string
    agent: string
    model: { providerId: string; modelId: string }
    createdBy?: { userId?: string; displayName: string }
  }): Promise<unknown>
  submitPrompt(input: {
    messageId?: string
    runId?: string
    sessionId: string
    workspaceId: string
    content: string
    agentId: string
    agentName: string
    submittedBy: { userId?: string; displayName: string }
  }): Promise<unknown>
  listSessionTranscript(input: { sessionId: string }): Promise<unknown>
  listFileTree(input: {
    workspaceId: string
    parentPath?: string | null
  }): Promise<unknown>
  readFileContent(input: { workspaceId: string; path: string }): Promise<unknown>
  getFileStatus(input: { workspaceId: string }): Promise<unknown>
  listSessionTodos(input: { sessionId: string }): Promise<unknown>
  listPendingPermissions(input: { sessionId: string }): Promise<unknown>
  replyPermission(input: {
    requestId: string
    sessionId: string
    action: 'allow' | 'deny'
    repliedBy?: { userId?: string; displayName: string }
    reason?: string
  }): Promise<unknown>
  loadConfig(input: { workspaceRoot: string }): Promise<SpecterCodeConfig>
  listProviders(input?: { workspaceRoot?: string }): Promise<ProviderSummary[] | unknown>
  listAgents(input?: { workspaceRoot?: string }): Promise<AgentSummary[] | unknown>
  listPendingQuestions(input: { sessionId?: string }): Promise<unknown>
  replyQuestion(input: { requestId: string; answers: string[][] }): Promise<boolean | unknown>
  rejectQuestion(input: { requestId: string; reason?: string }): Promise<boolean | unknown>
  listSkills(input: { workspaceRoot: string }): Promise<readonly SpecterCodeSkillInfo[] | unknown>
  listEvents(input: { afterOrder?: number }): Promise<readonly SpecterCodeStreamEvent[]>
  findFiles(input: {
    workspaceRoot: string
    query: string
    limit?: number
    type?: 'file' | 'directory'
  }): Promise<readonly string[]>
  findText(input: {
    workspaceRoot: string
    pattern: string
    limit?: number
  }): Promise<readonly OpenCodeTextMatch[]>
  findSymbols(input: {
    workspaceRoot: string
    query: string
    include?: string[]
    limit?: number
  }): Promise<readonly LspSymbol[]>
  listLspDiagnostics(input: {
    workspaceRoot: string
    include?: string[]
    limit?: number
  }): Promise<readonly LspDiagnostic[]>
  getVcsStatus(input: { workspaceRoot: string }): Promise<GitStatus | unknown>
  getVcsDiff(input: {
    workspaceRoot: string
    path?: string
    staged?: boolean
  }): Promise<GitDiff | unknown>
  applyVcsPatch(input: {
    workspaceRoot: string
    patch: string
    staged?: boolean
  }): Promise<{ paths: string[]; staged: boolean } | unknown>
  listPtyShells(input: { workspaceRoot?: string }): Promise<readonly PtyShellSummary[] | unknown>
  listPtySessions(input: { workspaceRoot?: string }): Promise<readonly ApiPtySession[] | unknown>
  startPtySession(input: {
    sessionId: string
    workspaceRoot: string
    cwd?: string
    shell?: string
    title?: string
    size?: PtySize
  }): Promise<ApiPtySession | unknown>
  getPtySession(input: { ptySessionId: string }): Promise<ApiPtySession | unknown>
  updatePtySession(input: {
    ptySessionId: string
    title?: string
    size?: PtySize
  }): Promise<ApiPtySession | unknown>
  stopPtySession(input: { ptySessionId: string }): Promise<boolean | unknown>
  createPtyConnectToken(input: { ptySessionId: string }): Promise<{ ticket: string; expires_in: number } | unknown>
  connectPtySession(input: { ptySessionId: string }): Promise<boolean | unknown>
}

export const INITIAL_OPENCODE_API_ROUTES = [
  { method: 'GET', normalizedPath: '/agent' },
  { method: 'GET', normalizedPath: '/config' },
  { method: 'GET', normalizedPath: '/event' },
  { method: 'GET', normalizedPath: '/find' },
  { method: 'GET', normalizedPath: '/find/file' },
  { method: 'GET', normalizedPath: '/find/symbol' },
  { method: 'GET', normalizedPath: '/file' },
  { method: 'GET', normalizedPath: '/file/content' },
  { method: 'GET', normalizedPath: '/file/status' },
  { method: 'GET', normalizedPath: '/lsp' },
  { method: 'GET', normalizedPath: '/permission' },
  { method: 'POST', normalizedPath: '/permission/:requestID/reply' },
  { method: 'GET', normalizedPath: '/provider' },
  { method: 'GET', normalizedPath: '/pty' },
  { method: 'POST', normalizedPath: '/pty' },
  { method: 'GET', normalizedPath: '/pty/shells' },
  { method: 'GET', normalizedPath: '/pty/:ptyID' },
  { method: 'PUT', normalizedPath: '/pty/:ptyID' },
  { method: 'DELETE', normalizedPath: '/pty/:ptyID' },
  { method: 'POST', normalizedPath: '/pty/:ptyID/connect-token' },
  { method: 'GET', normalizedPath: '/pty/:ptyID/connect' },
  { method: 'GET', normalizedPath: '/question' },
  { method: 'POST', normalizedPath: '/question/:requestID/reply' },
  { method: 'POST', normalizedPath: '/question/:requestID/reject' },
  { method: 'GET', normalizedPath: '/session' },
  { method: 'GET', normalizedPath: '/skill' },
  { method: 'POST', normalizedPath: '/session' },
  { method: 'GET', normalizedPath: '/session/:sessionID/message' },
  { method: 'POST', normalizedPath: '/session/:sessionID/prompt_async' },
  { method: 'GET', normalizedPath: '/session/:sessionID/todo' },
  { method: 'GET', normalizedPath: '/vcs' },
  { method: 'POST', normalizedPath: '/vcs/apply' },
  { method: 'GET', normalizedPath: '/vcs/diff' },
  { method: 'GET', normalizedPath: '/vcs/status' },
] satisfies RouteSpec[]

export const implementedOpenCodeApiRoutes = INITIAL_OPENCODE_API_ROUTES

export type CreateSpecterCodeApiRouterOptions = {
  runtime?: SpecterCodeApiRuntime
}

export function createSpecterCodeApiRouter(options: CreateSpecterCodeApiRouterOptions = {}) {
  const runtime = options.runtime ?? createLiveRuntime()

  return {
    routes: implementedOpenCodeApiRoutes,
    async handle(request: Request): Promise<Response> {
      try {
        return await dispatchOpenCodeApiRequest(request, runtime)
      } catch (error) {
        return jsonResponse({ error: errorMessage(error) }, 400)
      }
    },
  }
}

async function dispatchOpenCodeApiRequest(request: Request, runtime: SpecterCodeApiRuntime) {
  const url = new URL(request.url)
  const method = request.method.toUpperCase()
  const pathname = normalizeRequestPath(url.pathname)

  if (method === 'GET' && pathname === '/session') {
    return jsonResponse(
      await runtime.listSessions({ workspaceId: requiredQuery(url, 'workspaceId') }),
    )
  }

  if (method === 'GET' && pathname === '/event') {
    return createSpecterCodeEventStream({
      loadEvents: (input) => runtime.listEvents(input),
    }).open({
      afterOrder: optionalIntegerQuery(url, 'after'),
      live: optionalQuery(url, 'live') !== 'false',
      signal: request.signal,
    })
  }

  if (method === 'POST' && pathname === '/session') {
    const body = await readJsonBody(request)
    return jsonResponse(
      await runtime.createSession({
        sessionId: optionalString(body.sessionId),
        workspaceId: requiredString(body.workspaceId, 'workspaceId'),
        title: requiredString(body.title, 'title'),
        directory: requiredString(body.directory, 'directory'),
        agent: requiredString(body.agent, 'agent'),
        model: readModel(body.model),
        createdBy: readActor(body.createdBy),
      }),
    )
  }

  const sessionMessageMatch = matchPath(pathname, '/session/:sessionID/message')
  if (method === 'GET' && sessionMessageMatch) {
    return jsonResponse(
      await runtime.listSessionTranscript({
        sessionId: sessionMessageMatch.sessionID,
      }),
    )
  }

  const sessionTodoMatch = matchPath(pathname, '/session/:sessionID/todo')
  if (method === 'GET' && sessionTodoMatch) {
    return jsonResponse(
      await runtime.listSessionTodos({
        sessionId: sessionTodoMatch.sessionID,
      }),
    )
  }

  const promptAsyncMatch = matchPath(pathname, '/session/:sessionID/prompt_async')
  if (method === 'POST' && promptAsyncMatch) {
    const body = await readJsonBody(request)
    const agentId = requiredString(body.agentId, 'agentId')
    return jsonResponse(
      await runtime.submitPrompt({
        messageId: optionalString(body.messageId),
        runId: optionalString(body.runId),
        sessionId: promptAsyncMatch.sessionID,
        workspaceId: requiredString(body.workspaceId, 'workspaceId'),
        content: requiredString(body.content, 'content'),
        agentId,
        agentName: optionalString(body.agentName) ?? agentId,
        submittedBy: readActor(body.submittedBy) ?? { displayName: 'OpenCode API' },
      }),
    )
  }

  if (method === 'GET' && pathname === '/find/file') {
    return jsonResponse(
      await runtime.findFiles({
        workspaceRoot: workspaceRootFromFindQuery(url),
        query: requiredQuery(url, 'query'),
        limit: optionalIntegerQuery(url, 'limit'),
        type: readFindFileType(optionalQuery(url, 'type')),
      }),
    )
  }

  if (method === 'GET' && pathname === '/find') {
    return jsonResponse(
      await runtime.findText({
        workspaceRoot: workspaceRootFromFindQuery(url),
        pattern: requiredQuery(url, 'pattern'),
        limit: optionalIntegerQuery(url, 'limit'),
      }),
    )
  }

  if (method === 'GET' && pathname === '/find/symbol') {
    return jsonResponse(
      await runtime.findSymbols({
        workspaceRoot: workspaceRootFromFindQuery(url),
        query: requiredQuery(url, 'query'),
        include: optionalListQuery(url, 'include'),
        limit: optionalIntegerQuery(url, 'limit'),
      }),
    )
  }

  if (method === 'GET' && pathname === '/lsp') {
    return jsonResponse(
      await runtime.listLspDiagnostics({
        workspaceRoot: workspaceRootFromFindQuery(url),
        include: optionalListQuery(url, 'include'),
        limit: optionalIntegerQuery(url, 'limit'),
      }),
    )
  }

  if (method === 'GET' && (pathname === '/vcs' || pathname === '/vcs/status')) {
    return jsonResponse(await runtime.getVcsStatus({ workspaceRoot: workspaceRootFromQuery(url) }))
  }

  if (method === 'GET' && pathname === '/vcs/diff') {
    return jsonResponse(
      await runtime.getVcsDiff({
        workspaceRoot: workspaceRootFromQuery(url),
        path: optionalQuery(url, 'path'),
        staged: optionalBooleanQuery(url, 'staged'),
      }),
    )
  }

  if (method === 'POST' && pathname === '/vcs/apply') {
    const body = await readJsonBody(request)
    return jsonResponse(
      await runtime.applyVcsPatch({
        workspaceRoot: optionalString(body.workspaceRoot) ?? process.cwd(),
        patch: requiredString(body.patch, 'patch'),
        staged: optionalBoolean(body.staged),
      }),
    )
  }

  if (method === 'GET' && pathname === '/file') {
    return jsonResponse(
      await runtime.listFileTree({
        workspaceId: requiredQuery(url, 'workspaceId'),
        parentPath: optionalQuery(url, 'path') ?? optionalQuery(url, 'parentPath'),
      }),
    )
  }

  if (method === 'GET' && pathname === '/file/content') {
    return jsonResponse({
      content: await runtime.readFileContent({
        workspaceId: requiredQuery(url, 'workspaceId'),
        path: requiredQuery(url, 'path'),
      }),
    })
  }

  if (method === 'GET' && pathname === '/file/status') {
    return jsonResponse(
      await runtime.getFileStatus({ workspaceId: requiredQuery(url, 'workspaceId') }),
    )
  }

  if (method === 'GET' && pathname === '/permission') {
    return jsonResponse(
      await runtime.listPendingPermissions({
        sessionId: requiredQuery(url, 'sessionId'),
      }),
    )
  }

  const permissionReplyMatch = matchPath(pathname, '/permission/:requestID/reply')
  if (method === 'POST' && permissionReplyMatch) {
    const body = await readJsonBody(request)
    return jsonResponse(
      await runtime.replyPermission({
        requestId: permissionReplyMatch.requestID,
        sessionId: requiredString(body.sessionId, 'sessionId'),
        action: readPermissionAction(body.action),
        repliedBy: readActor(body.repliedBy),
        reason: optionalString(body.reason),
      }),
    )
  }

  if (method === 'GET' && pathname === '/config') {
    return jsonResponse(
      await runtime.loadConfig({ workspaceRoot: workspaceRootFromQuery(url) }),
    )
  }

  if (method === 'GET' && pathname === '/question') {
    return jsonResponse(
      await runtime.listPendingQuestions({ sessionId: optionalQuery(url, 'sessionId') }),
    )
  }

  const questionReplyMatch = matchPath(pathname, '/question/:requestID/reply')
  if (method === 'POST' && questionReplyMatch) {
    const body = await readJsonBody(request)
    return jsonResponse(
      await runtime.replyQuestion({
        requestId: questionReplyMatch.requestID,
        answers: readQuestionAnswers(body.answers),
      }),
    )
  }

  const questionRejectMatch = matchPath(pathname, '/question/:requestID/reject')
  if (method === 'POST' && questionRejectMatch) {
    const body = await readJsonBody(request)
    return jsonResponse(
      await runtime.rejectQuestion({
        requestId: questionRejectMatch.requestID,
        reason: optionalString(body.reason),
      }),
    )
  }

  if (method === 'GET' && pathname === '/provider') {
    return jsonResponse(
      await runtime.listProviders({ workspaceRoot: optionalQuery(url, 'workspaceRoot') }),
    )
  }

  if (method === 'GET' && pathname === '/pty/shells') {
    return jsonResponse(
      await runtime.listPtyShells({ workspaceRoot: workspaceRootFromFindQuery(url) }),
    )
  }

  if (method === 'GET' && pathname === '/pty') {
    return jsonResponse(
      await runtime.listPtySessions({ workspaceRoot: workspaceRootFromFindQuery(url) }),
    )
  }

  if (method === 'POST' && pathname === '/pty') {
    const body = await readJsonBody(request)
    return jsonResponse(
      await runtime.startPtySession({
        sessionId: optionalString(body.sessionId) ?? 'opencode-pty-session',
        workspaceRoot: workspaceRootFromFindQuery(url),
        cwd: optionalString(body.cwd),
        shell: optionalString(body.command) ?? optionalString(body.shell),
        title: optionalString(body.title),
        size: readPtySize(body.size),
      }),
    )
  }

  const ptyConnectTokenMatch = matchPath(pathname, '/pty/:ptyID/connect-token')
  if (method === 'POST' && ptyConnectTokenMatch) {
    return jsonResponse(
      await runtime.createPtyConnectToken({ ptySessionId: ptyConnectTokenMatch.ptyID }),
    )
  }

  const ptyConnectMatch = matchPath(pathname, '/pty/:ptyID/connect')
  if (method === 'GET' && ptyConnectMatch) {
    return jsonResponse(await runtime.connectPtySession({ ptySessionId: ptyConnectMatch.ptyID }))
  }

  const ptySessionMatch = matchPath(pathname, '/pty/:ptyID')
  if (method === 'GET' && ptySessionMatch) {
    return jsonResponse(await runtime.getPtySession({ ptySessionId: ptySessionMatch.ptyID }))
  }

  if (method === 'PUT' && ptySessionMatch) {
    const body = await readJsonBody(request)
    return jsonResponse(
      await runtime.updatePtySession({
        ptySessionId: ptySessionMatch.ptyID,
        title: optionalString(body.title),
        size: readPtySize(body.size),
      }),
    )
  }

  if (method === 'DELETE' && ptySessionMatch) {
    return jsonResponse(await runtime.stopPtySession({ ptySessionId: ptySessionMatch.ptyID }))
  }

  if (method === 'GET' && pathname === '/skill') {
    return jsonResponse(
      await runtime.listSkills({ workspaceRoot: workspaceRootFromFindQuery(url) }),
    )
  }

  if (method === 'GET' && pathname === '/agent') {
    return jsonResponse(
      await runtime.listAgents({ workspaceRoot: optionalQuery(url, 'workspaceRoot') }),
    )
  }

  return jsonResponse(
    { error: `No OpenCode-compatible route for ${method} ${pathname}` },
    404,
  )
}

const livePtyManager = createPtySessionManager()
const livePtyMetadata = new Map<string, { title?: string; size?: PtySize }>()

function createLiveRuntime(): SpecterCodeApiRuntime {
  return {
    async listSessions(input) {
      const runtime = await import('./server-runtime.server')
      return runtime.listSpecterCodeSessionsOnServer(input)
    },
    async createSession(input) {
      const runtime = await import('./server-runtime.server')
      return runtime.createSpecterCodeSessionOnServer(input)
    },
    async submitPrompt(input) {
      const runtime = await import('./server-runtime.server')
      return runtime.submitSpecterCodePromptOnServer(input)
    },
    async listSessionTranscript(input) {
      const runtime = await import('./server-runtime.server')
      return runtime.listSpecterCodeSessionTranscriptOnServer(input)
    },
    async listFileTree(input) {
      const runtime = await import('./server-runtime.server')
      return runtime.listSpecterCodeFilesystemTreeOnServer(input)
    },
    async readFileContent(input) {
      const runtime = await import('./server-runtime.server')
      return runtime.readSpecterCodeWorkspaceTextFileOnServer(input)
    },
    async getFileStatus(input) {
      const runtime = await import('./server-runtime.server')
      return runtime.getSpecterCodeFilesystemStatusOnServer(input)
    },
    async listSessionTodos(input) {
      const runtime = await import('./server-runtime.server')
      return runtime.listSpecterCodeSessionTodosOnServer(input)
    },
    async listPendingPermissions(input) {
      const runtime = await import('./server-runtime.server')
      return runtime.listSpecterCodePendingPermissionsOnServer(input)
    },
    async replyPermission(input) {
      const runtime = await import('./server-runtime.server')
      return runtime.replySpecterCodeToolApprovalOnServer(input)
    },
    async loadConfig(input) {
      return loadSpecterCodeConfig({ workspaceRoot: input.workspaceRoot })
    },
    async listProviders(input) {
      const config = await loadConfigForRegistry(input?.workspaceRoot)
      return createProviderRegistry({ config }).listProviders()
    },
    async listAgents(input) {
      const config = await loadConfigForRegistry(input?.workspaceRoot)
      return createAgentRegistry({ config }).listAgents()
    },
    async listPendingQuestions(input) {
      const runtime = await import('./server-runtime.server')
      return runtime.listSpecterCodePendingQuestionsOnServer(input ?? {})
    },
    async replyQuestion(input) {
      const runtime = await import('./server-runtime.server')
      const question = await findPendingQuestion(
        input.requestId,
        runtime.listSpecterCodePendingQuestionsOnServer,
      )
      await runtime.replySpecterCodeQuestionOnServer({
        questionId: input.requestId,
        sessionId: question.sessionId,
        answer: formatQuestionAnswers(input.answers),
      })
      return true
    },
    async rejectQuestion(input) {
      const runtime = await import('./server-runtime.server')
      const question = await findPendingQuestion(
        input.requestId,
        runtime.listSpecterCodePendingQuestionsOnServer,
      )
      await runtime.replySpecterCodeQuestionOnServer({
        questionId: input.requestId,
        sessionId: question.sessionId,
        answer: input.reason ? `Rejected: ${input.reason}` : 'Rejected',
      })
      return true
    },
    async listSkills(input) {
      return listSpecterCodeSkills(input)
    },
    async listEvents(input) {
      const runtime = await import('./server-runtime.server')
      return runtime.listSpecterCodeEventsOnServer(input)
    },
    async findFiles(input) {
      return findWorkspaceFiles(input)
    },
    async findText(input) {
      return findWorkspaceText(input)
    },
    async findSymbols(input) {
      return limitItems(await findWorkspaceSymbols(input), input.limit)
    },
    async listLspDiagnostics(input) {
      return limitItems(await collectTypeScriptDiagnostics(input), input.limit)
    },
    async getVcsStatus(input) {
      return getGitStatus(input)
    },
    async getVcsDiff(input) {
      return getGitDiff(input)
    },
    async applyVcsPatch(input) {
      return applyGitPatch(input)
    },
    async listPtyShells() {
      return listAvailableShells()
    },
    async listPtySessions() {
      return livePtyManager.list().map(withPtyMetadata)
    },
    async startPtySession(input) {
      const session = await livePtyManager.start({
        sessionId: input.sessionId,
        workspaceRoot: input.workspaceRoot,
        cwd: input.cwd,
        shell: input.shell,
      })
      if (input.title || input.size) livePtyMetadata.set(session.id, { title: input.title, size: input.size })
      return withPtyMetadata(session)
    },
    async getPtySession(input) {
      return getLivePtySession(input.ptySessionId)
    },
    async updatePtySession(input) {
      getLivePtySession(input.ptySessionId)
      const previous = livePtyMetadata.get(input.ptySessionId) ?? {}
      livePtyMetadata.set(input.ptySessionId, {
        title: input.title ?? previous.title,
        size: input.size ?? previous.size,
      })
      return getLivePtySession(input.ptySessionId)
    },
    async stopPtySession(input) {
      await livePtyManager.stop(input.ptySessionId)
      livePtyMetadata.delete(input.ptySessionId)
      return true
    },
    async createPtyConnectToken(input) {
      getLivePtySession(input.ptySessionId)
      return { ticket: `pty-${input.ptySessionId}-${randomUUID()}`, expires_in: 30 }
    },
    async connectPtySession(input) {
      getLivePtySession(input.ptySessionId)
      return true
    },
  }
}

function withPtyMetadata(session: PtySession): ApiPtySession {
  return { ...session, ...livePtyMetadata.get(session.id) }
}

function getLivePtySession(ptySessionId: string) {
  const session = livePtyManager.list().find((candidate) => candidate.id === ptySessionId)
  if (!session) throw new Error('Unknown PTY session: ' + ptySessionId)
  return withPtyMetadata(session)
}

function listAvailableShells(): PtyShellSummary[] {
  const paths = new Set([process.env.SHELL, '/bin/bash', '/bin/sh'].filter(Boolean) as string[])
  return [...paths].map((shellPath) => ({
    path: shellPath,
    name: shellPath.split('/').filter(Boolean).at(-1) ?? shellPath,
    acceptable: true,
  }))
}

async function loadConfigForRegistry(workspaceRoot?: string) {
  return loadSpecterCodeConfig({ workspaceRoot: workspaceRoot ?? process.cwd() })
}

function normalizeRequestPath(pathname: string) {
  const normalized = pathname.replace(/\/+$/, '')
  return normalized || '/'
}

function matchPath(pathname: string, pattern: string) {
  const pathParts = pathname.split('/').filter(Boolean)
  const patternParts = pattern.split('/').filter(Boolean)
  if (pathParts.length !== patternParts.length) return undefined

  const params: Record<string, string> = {}
  for (let index = 0; index < patternParts.length; index += 1) {
    const patternPart = patternParts[index]
    const pathPart = pathParts[index]
    if (patternPart?.startsWith(':')) {
      params[patternPart.slice(1)] = decodeURIComponent(pathPart ?? '')
      continue
    }
    if (patternPart !== pathPart) return undefined
  }
  return params
}

async function readJsonBody(request: Request) {
  try {
    const text = await request.text()
    if (!text.trim()) return {}
    const parsed = JSON.parse(text) as unknown
    if (!isRecord(parsed)) throw new Error('JSON request body must be an object')
    return parsed
  } catch (error) {
    if (error instanceof Error && error.message === 'JSON request body must be an object') {
      throw error
    }
    throw new Error('Invalid JSON request body')
  }
}

function requiredQuery(url: URL, name: string) {
  const value = optionalQuery(url, name)
  if (!value) throw new Error(`Missing required query parameter: ${name}`)
  return value
}

function optionalQuery(url: URL, name: string) {
  const value = url.searchParams.get(name)
  return value && value.trim() ? value : undefined
}

function optionalIntegerQuery(url: URL, name: string) {
  const value = optionalQuery(url, name)
  if (value === undefined) return undefined
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid integer query parameter: ${name}`)
  }
  return parsed
}

function optionalListQuery(url: URL, name: string) {
  const values = url.searchParams
    .getAll(name)
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean)
  return values.length ? values : undefined
}

function optionalBooleanQuery(url: URL, name: string) {
  return optionalBoolean(optionalQuery(url, name))
}

function optionalBoolean(value: unknown) {
  if (value === undefined) return undefined
  if (value === true || value === 'true') return true
  if (value === false || value === 'false') return false
  throw new Error('Invalid boolean value')
}

function workspaceRootFromQuery(url: URL) {
  return optionalQuery(url, 'workspaceRoot') ?? process.cwd()
}

function workspaceRootFromFindQuery(url: URL) {
  return optionalQuery(url, 'directory') ?? optionalQuery(url, 'workspace') ?? process.cwd()
}

function readFindFileType(value: string | undefined) {
  if (value === undefined) return undefined
  if (value === 'file' || value === 'directory') return value
  throw new Error('Invalid find file type')
}

function readQuestionAnswers(value: unknown) {
  if (!Array.isArray(value)) throw new Error('Missing required field: answers')
  const answers = value.map((answer) => {
    if (!Array.isArray(answer)) throw new Error('Invalid question answer')
    return answer
      .map((label) => {
        if (typeof label !== 'string') throw new Error('Invalid question answer')
        return label.trim()
      })
      .filter(Boolean)
  })
  if (!answers.length || !answers.some((answer) => answer.length > 0)) {
    throw new Error('Question answer is required')
  }
  return answers
}

function formatQuestionAnswers(answers: string[][]) {
  return answers.map((answer) => answer.join(', ')).filter(Boolean).join(' | ')
}

type PendingQuestionSummary = { questionId: string; sessionId: string }

async function findPendingQuestion(
  questionId: string,
  listQuestions: (input: { sessionId?: string }) => Promise<unknown>,
) {
  const questions = await listQuestions({})
  if (!Array.isArray(questions)) throw new Error('Pending question list is unavailable')
  const question = questions.find((candidate): candidate is PendingQuestionSummary => {
    return (
      isRecord(candidate) &&
      candidate.questionId === questionId &&
      typeof candidate.sessionId === 'string'
    )
  })
  if (!question) throw new Error(`Pending question not found: ${questionId}`)
  return question
}

function requiredString(value: unknown, name: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Missing required field: ${name}`)
  }
  return value
}

function optionalString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function readPtySize(value: unknown) {
  if (value === undefined || value === null) return undefined
  if (!isRecord(value)) throw new Error('Invalid PTY size')
  const rows = Number(value.rows)
  const cols = Number(value.cols)
  if (!Number.isInteger(rows) || rows <= 0 || !Number.isInteger(cols) || cols <= 0) {
    throw new Error('Invalid PTY size')
  }
  return { rows, cols }
}

function readModel(value: unknown) {
  if (!isRecord(value)) throw new Error('Missing required field: model')
  return {
    providerId: requiredString(value.providerId, 'model.providerId'),
    modelId: requiredString(value.modelId, 'model.modelId'),
  }
}

function readActor(value: unknown) {
  if (!isRecord(value)) return undefined
  const displayName = optionalString(value.displayName)
  if (!displayName) return undefined
  return {
    userId: optionalString(value.userId),
    displayName,
  }
}

function readPermissionAction(value: unknown) {
  if (value === 'allow' || value === 'deny') return value
  throw new Error('Missing required field: action')
}

function jsonResponse(value: unknown, status = 200) {
  return Response.json(value, { status })
}

function limitItems<T>(items: readonly T[], limit: number | undefined) {
  return limit === undefined ? items : items.slice(0, limit)
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

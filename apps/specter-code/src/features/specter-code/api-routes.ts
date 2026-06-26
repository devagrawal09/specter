import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  createAgentRegistry,
  type AgentSummary,
} from './adapters/agent-registry'
import {
  loadSpecterCodeConfig,
  type SpecterCodeConfig,
} from './adapters/config-loader'
import {
  createSpecterCodeEventStream,
  type SpecterCodeStreamEvent,
} from './adapters/event-stream'
import {
  findWorkspaceFiles,
  findWorkspaceText,
  type OpenCodeTextMatch,
} from './adapters/find'
import {
  applyGitPatch,
  getGitDiff,
  revertWorkspacePaths,
  getGitStatus,
  type GitDiff,
  type GitStatus,
} from './adapters/git'
import {
  createProviderRegistry,
  type ProviderSummary,
} from './adapters/llm-provider'
import { createPtySessionManager, type PtySession } from './adapters/pty'
import {
  collectTypeScriptDiagnostics,
  findWorkspaceSymbols,
  type LspDiagnostic,
  type LspSymbol,
} from './adapters/lsp'
import {
  listSpecterCodeCommands,
  renderSpecterCodeCommandPrompt,
  type SpecterCodeCommandInfo,
} from './adapters/command-registry'
import {
  listSpecterCodeSkills,
  type SpecterCodeSkillInfo,
} from './adapters/skills'
import type { RouteSpec } from './domain/openapi-compat'

export type JsonRecord = Record<string, unknown>

export type PtyShellSummary = {
  path: string
  name: string
  acceptable: boolean
}

export type PtySize = { rows: number; cols: number }
export type ApiPtySession = PtySession & { title?: string; size?: PtySize }
export type ApiMcpStatus = {
  type?: string
  name: string
  status: 'connected' | 'disconnected' | 'disabled' | 'failed'
  error?: string
  config?: unknown
}

export type ProjectSummary = {
  id: string
  directory: string
  name: string
  configSources: string[]
}

export type FormatterStatus = {
  name: string
  command?: string
  enabled: boolean
  status?: 'configured' | 'disabled' | 'unsupported'
}

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
  getSession(input: { sessionId: string }): Promise<unknown>
  updateSession(input: {
    sessionId: string
    title?: string
    directory?: string
    agent?: string
    model?: { providerId: string; modelId: string }
    updatedBy?: { userId?: string; displayName: string }
  }): Promise<unknown>
  deleteSession(input: {
    sessionId: string
    deletedBy?: { userId?: string; displayName: string }
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
  listSessionStatus(input: { workspaceRoot?: string }): Promise<unknown>
  createSessionMessage(input: {
    sessionId: string
    messageId?: string
    content: string
    agentId: string
    agentName?: string
    model?: { providerId: string; modelId: string }
    noReply?: boolean
    submittedBy?: { userId?: string; displayName: string }
  }): Promise<unknown>
  abortSession(input: { sessionId: string }): Promise<boolean | unknown>
  listFileTree(input: {
    workspaceId: string
    parentPath?: string | null
  }): Promise<unknown>
  readFileContent(input: {
    workspaceId: string
    path: string
  }): Promise<unknown>
  getFileStatus(input: { workspaceId: string }): Promise<unknown>
  listSessionTodos(input: { sessionId: string }): Promise<unknown>
  listSessionChildren(input: { sessionId: string }): Promise<unknown>
  forkSession(input: {
    sessionId: string
    newSessionId?: string
    title?: string
    createdBy?: { userId?: string; displayName: string }
  }): Promise<unknown>
  listPendingPermissions(input: { sessionId: string }): Promise<unknown>
  replyPermission(input: {
    requestId: string
    sessionId: string
    action: 'allow' | 'deny'
    repliedBy?: { userId?: string; displayName: string }
    reason?: string
  }): Promise<unknown>
  loadConfig(input: { workspaceRoot: string }): Promise<SpecterCodeConfig>
  updateConfig(input: {
    workspaceRoot: string
    patch: JsonRecord
  }): Promise<SpecterCodeConfig | unknown>
  listProjects(input: {
    workspaceRoot: string
  }): Promise<readonly ProjectSummary[] | unknown>
  listFormatterStatus(input: {
    workspaceRoot: string
  }): Promise<readonly FormatterStatus[] | unknown>
  listProviders(input?: {
    workspaceRoot?: string
  }): Promise<ProviderSummary[] | unknown>
  listAgents(input?: {
    workspaceRoot?: string
  }): Promise<AgentSummary[] | unknown>
  listPendingQuestions(input: { sessionId?: string }): Promise<unknown>
  replyQuestion(input: {
    requestId: string
    answers: string[][]
  }): Promise<boolean | unknown>
  rejectQuestion(input: {
    requestId: string
    reason?: string
  }): Promise<boolean | unknown>
  listSkills(input: {
    workspaceRoot: string
  }): Promise<readonly SpecterCodeSkillInfo[] | unknown>
  listCommands(input: {
    workspaceRoot: string
  }): Promise<readonly SpecterCodeCommandInfo[] | unknown>
  executeSessionCommand(input: {
    sessionId: string
    messageId?: string
    workspaceRoot: string
    command: string
    arguments?: string
    agentId?: string
    model?: { providerId: string; modelId: string }
  }): Promise<unknown>
  listEvents(input: {
    afterOrder?: number
  }): Promise<readonly SpecterCodeStreamEvent[]>
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
  listMcpStatus(input: {
    workspaceRoot: string
  }): Promise<Record<string, ApiMcpStatus> | unknown>
  addMcpServer(input: {
    workspaceRoot: string
    name: string
    config: unknown
  }): Promise<Record<string, ApiMcpStatus> | unknown>
  connectMcpServer(input: {
    workspaceRoot: string
    name: string
  }): Promise<boolean | unknown>
  disconnectMcpServer(input: {
    workspaceRoot: string
    name: string
  }): Promise<boolean | unknown>
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
  revertSession(input: {
    sessionId: string
    workspaceRoot: string
    paths: string[]
  }): Promise<{ paths: string[] } | unknown>
  listPtyShells(input: {
    workspaceRoot?: string
  }): Promise<readonly PtyShellSummary[] | unknown>
  listPtySessions(input: {
    workspaceRoot?: string
  }): Promise<readonly ApiPtySession[] | unknown>
  startPtySession(input: {
    sessionId: string
    workspaceRoot: string
    cwd?: string
    shell?: string
    title?: string
    size?: PtySize
  }): Promise<ApiPtySession | unknown>
  getPtySession(input: {
    ptySessionId: string
  }): Promise<ApiPtySession | unknown>
  updatePtySession(input: {
    ptySessionId: string
    title?: string
    size?: PtySize
  }): Promise<ApiPtySession | unknown>
  stopPtySession(input: { ptySessionId: string }): Promise<boolean | unknown>
  createPtyConnectToken(input: {
    ptySessionId: string
  }): Promise<{ ticket: string; expires_in: number } | unknown>
  connectPtySession(input: { ptySessionId: string }): Promise<boolean | unknown>
}

export const INITIAL_OPENCODE_API_ROUTES = [
  { method: 'GET', normalizedPath: '/agent' },
  { method: 'GET', normalizedPath: '/api/model' },
  { method: 'GET', normalizedPath: '/api/provider' },
  { method: 'GET', normalizedPath: '/api/session' },
  { method: 'GET', normalizedPath: '/api/session/:sessionID/message' },
  { method: 'POST', normalizedPath: '/api/session/:sessionID/prompt' },
  { method: 'GET', normalizedPath: '/config' },
  { method: 'PATCH', normalizedPath: '/config' },
  { method: 'GET', normalizedPath: '/config/providers' },
  { method: 'GET', normalizedPath: '/command' },
  { method: 'GET', normalizedPath: '/event' },
  { method: 'GET', normalizedPath: '/formatter' },
  { method: 'GET', normalizedPath: '/global/health' },
  { method: 'GET', normalizedPath: '/find' },
  { method: 'GET', normalizedPath: '/find/file' },
  { method: 'GET', normalizedPath: '/find/symbol' },
  { method: 'GET', normalizedPath: '/file' },
  { method: 'GET', normalizedPath: '/file/content' },
  { method: 'GET', normalizedPath: '/file/status' },
  { method: 'GET', normalizedPath: '/lsp' },
  { method: 'GET', normalizedPath: '/mcp' },
  { method: 'POST', normalizedPath: '/mcp' },
  { method: 'POST', normalizedPath: '/mcp/:name/connect' },
  { method: 'POST', normalizedPath: '/mcp/:name/disconnect' },
  { method: 'GET', normalizedPath: '/path' },
  { method: 'GET', normalizedPath: '/permission' },
  { method: 'POST', normalizedPath: '/permission/:requestID/reply' },
  { method: 'GET', normalizedPath: '/project' },
  { method: 'GET', normalizedPath: '/project/current' },
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
  { method: 'GET', normalizedPath: '/session/status' },
  { method: 'GET', normalizedPath: '/skill' },
  { method: 'POST', normalizedPath: '/session' },
  { method: 'GET', normalizedPath: '/session/:sessionID' },
  { method: 'POST', normalizedPath: '/session/:sessionID/abort' },
  { method: 'GET', normalizedPath: '/session/:sessionID/children' },
  { method: 'POST', normalizedPath: '/session/:sessionID/command' },
  { method: 'POST', normalizedPath: '/session/:sessionID/message' },
  { method: 'DELETE', normalizedPath: '/session/:sessionID' },
  { method: 'POST', normalizedPath: '/session/:sessionID/fork' },
  { method: 'PATCH', normalizedPath: '/session/:sessionID' },
  { method: 'GET', normalizedPath: '/session/:sessionID/diff' },
  { method: 'GET', normalizedPath: '/session/:sessionID/message' },
  { method: 'POST', normalizedPath: '/session/:sessionID/prompt_async' },
  { method: 'POST', normalizedPath: '/session/:sessionID/revert' },
  { method: 'GET', normalizedPath: '/session/:sessionID/todo' },
  { method: 'GET', normalizedPath: '/vcs' },
  { method: 'POST', normalizedPath: '/vcs/apply' },
  { method: 'GET', normalizedPath: '/vcs/diff' },
  { method: 'GET', normalizedPath: '/vcs/diff/raw' },
  { method: 'GET', normalizedPath: '/vcs/status' },
] satisfies RouteSpec[]

export const implementedOpenCodeApiRoutes = INITIAL_OPENCODE_API_ROUTES

export type CreateSpecterCodeApiRouterOptions = {
  runtime?: SpecterCodeApiRuntime
}

export function createSpecterCodeApiRouter(
  options: CreateSpecterCodeApiRouterOptions = {},
) {
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

async function dispatchOpenCodeApiRequest(
  request: Request,
  runtime: SpecterCodeApiRuntime,
) {
  const url = new URL(request.url)
  const method = request.method.toUpperCase()
  const pathname = normalizeRequestPath(url.pathname)

  if (method === 'GET' && pathname === '/global/health') {
    return jsonResponse({ ok: true })
  }

  if (method === 'GET' && pathname === '/path') {
    const directory = workspaceRootFromFindQuery(url)
    return jsonResponse({ path: directory, directory })
  }

  if (method === 'GET' && (pathname === '/api/provider' || pathname === '/api/model')) {
    return jsonResponse(
      await runtime.listProviders({
        workspaceRoot: optionalQuery(url, 'workspaceRoot'),
      }),
    )
  }

  if (method === 'GET' && pathname === '/config/providers') {
    return jsonResponse(
      await runtime.listProviders({
        workspaceRoot: workspaceRootFromFindQuery(url),
      }),
    )
  }

  if (method === 'GET' && pathname === '/session') {
    return jsonResponse(
      await runtime.listSessions({
        workspaceId: requiredQuery(url, 'workspaceId'),
      }),
    )
  }

  if (method === 'GET' && pathname === '/api/session') {
    return jsonResponse(
      await runtime.listSessions({
        workspaceId: requiredQuery(url, 'workspaceId'),
      }),
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

  if (method === 'GET' && pathname === '/session/status') {
    return jsonResponse(
      await runtime.listSessionStatus({
        workspaceRoot: workspaceRootFromFindQuery(url),
      }),
    )
  }

  const sessionMatch = matchPath(pathname, '/session/:sessionID')
  if (method === 'GET' && sessionMatch) {
    return jsonResponse(
      await runtime.getSession({ sessionId: sessionMatch.sessionID }),
    )
  }

  if (method === 'PATCH' && sessionMatch) {
    const body = await readJsonBody(request)
    return jsonResponse(
      await runtime.updateSession({
        sessionId: sessionMatch.sessionID,
        title: optionalString(body.title),
        directory: optionalString(body.directory),
        agent: optionalString(body.agent),
        model: body.model === undefined ? undefined : readModel(body.model),
        updatedBy: readActor(body.updatedBy),
      }),
    )
  }

  if (method === 'DELETE' && sessionMatch) {
    const body = await readJsonBody(request)
    return jsonResponse(
      await runtime.deleteSession({
        sessionId: sessionMatch.sessionID,
        deletedBy: readActor(body.deletedBy),
      }),
    )
  }

  const sessionMessageMatch = matchPath(pathname, '/session/:sessionID/message')
  const apiSessionMessageMatch = matchPath(pathname, '/api/session/:sessionID/message')
  const transcriptMatch = sessionMessageMatch ?? apiSessionMessageMatch
  if (method === 'GET' && transcriptMatch) {
    return jsonResponse(
      await runtime.listSessionTranscript({
        sessionId: transcriptMatch.sessionID,
      }),
    )
  }

  if (method === 'POST' && sessionMessageMatch) {
    const body = await readJsonBody(request)
    const agentId = optionalString(body.agent) ?? 'build'
    return jsonResponse(
      await runtime.createSessionMessage({
        sessionId: sessionMessageMatch.sessionID,
        messageId: optionalString(body.messageID) ?? optionalString(body.messageId),
        content: readMessagePartsText(body.parts),
        agentId,
        agentName: optionalString(body.agentName) ?? agentId,
        model: readOptionalOpenCodeModel(body.model),
        noReply: optionalBoolean(body.noReply),
        submittedBy: readActor(body.submittedBy) ?? { displayName: 'OpenCode API' },
      }),
    )
  }

  const sessionAbortMatch = matchPath(pathname, '/session/:sessionID/abort')
  if (method === 'POST' && sessionAbortMatch) {
    return jsonResponse(
      await runtime.abortSession({ sessionId: sessionAbortMatch.sessionID }),
    )
  }

  const sessionCommandMatch = matchPath(pathname, '/session/:sessionID/command')
  if (method === 'POST' && sessionCommandMatch) {
    const body = await readJsonBody(request)
    return jsonResponse(
      await runtime.executeSessionCommand({
        sessionId: sessionCommandMatch.sessionID,
        messageId: optionalString(body.messageID) ?? optionalString(body.messageId),
        workspaceRoot: workspaceRootFromFindQuery(url),
        command: requiredString(body.command ?? body.name, 'command'),
        arguments: optionalString(body.arguments) ?? optionalString(body.argument),
        agentId: optionalString(body.agent),
        model: readOptionalOpenCodeModel(body.model),
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

  const sessionChildrenMatch = matchPath(pathname, '/session/:sessionID/children')
  if (method === 'GET' && sessionChildrenMatch) {
    return jsonResponse(
      await runtime.listSessionChildren({
        sessionId: sessionChildrenMatch.sessionID,
      }),
    )
  }

  const forkSessionMatch = matchPath(pathname, '/session/:sessionID/fork')
  if (method === 'POST' && forkSessionMatch) {
    const body = await readJsonBody(request)
    return jsonResponse(
      await runtime.forkSession({
        sessionId: forkSessionMatch.sessionID,
        newSessionId: optionalString(body.sessionId) ?? optionalString(body.newSessionId),
        title: optionalString(body.title),
        createdBy: readActor(body.createdBy),
      }),
    )
  }

  const promptAsyncMatch = matchPath(
    pathname,
    '/session/:sessionID/prompt_async',
  )
  const apiPromptMatch = matchPath(pathname, '/api/session/:sessionID/prompt')
  const promptMatch = promptAsyncMatch ?? apiPromptMatch
  if (method === 'POST' && promptMatch) {
    const body = await readJsonBody(request)
    const agentId =
      optionalString(body.agentId) ?? optionalString(body.agent) ?? 'build'
    return jsonResponse(
      await runtime.submitPrompt({
        messageId:
          optionalString(body.messageId) ?? optionalString(body.messageID),
        runId: optionalString(body.runId),
        sessionId: promptMatch.sessionID,
        workspaceId: requiredString(body.workspaceId, 'workspaceId'),
        content: optionalString(body.content) ?? readMessagePartsText(body.parts),
        agentId,
        agentName: optionalString(body.agentName) ?? agentId,
        submittedBy: readActor(body.submittedBy) ?? {
          displayName: 'OpenCode API',
        },
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

  if (method === 'GET' && pathname === '/mcp') {
    return jsonResponse(
      await runtime.listMcpStatus({
        workspaceRoot: workspaceRootFromFindQuery(url),
      }),
    )
  }

  if (method === 'POST' && pathname === '/mcp') {
    const body = await readJsonBody(request)
    return jsonResponse(
      await runtime.addMcpServer({
        workspaceRoot: workspaceRootFromFindQuery(url),
        name: requiredString(body.name, 'name'),
        config: requiredRecord(body.config, 'config'),
      }),
    )
  }

  const mcpConnectMatch = matchPath(pathname, '/mcp/:name/connect')
  if (method === 'POST' && mcpConnectMatch) {
    return jsonResponse(
      await runtime.connectMcpServer({
        workspaceRoot: workspaceRootFromFindQuery(url),
        name: mcpConnectMatch.name,
      }),
    )
  }

  const mcpDisconnectMatch = matchPath(pathname, '/mcp/:name/disconnect')
  if (method === 'POST' && mcpDisconnectMatch) {
    return jsonResponse(
      await runtime.disconnectMcpServer({
        workspaceRoot: workspaceRootFromFindQuery(url),
        name: mcpDisconnectMatch.name,
      }),
    )
  }

  if (method === 'GET' && (pathname === '/vcs' || pathname === '/vcs/status')) {
    return jsonResponse(
      await runtime.getVcsStatus({
        workspaceRoot: workspaceRootFromQuery(url),
      }),
    )
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

  if (method === 'GET' && pathname === '/vcs/diff/raw') {
    const diff = await runtime.getVcsDiff({
      workspaceRoot: workspaceRootFromQuery(url),
      path: optionalQuery(url, 'path'),
      staged: optionalBooleanQuery(url, 'staged'),
    })
    return textResponse(gitDiffPatch(diff))
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

  const sessionDiffMatch = matchPath(pathname, '/session/:sessionID/diff')
  if (method === 'GET' && sessionDiffMatch) {
    return jsonResponse(
      await runtime.getVcsDiff({
        workspaceRoot: workspaceRootFromQuery(url),
        path: optionalQuery(url, 'path'),
        staged: optionalBooleanQuery(url, 'staged'),
      }),
    )
  }

  const sessionRevertMatch = matchPath(pathname, '/session/:sessionID/revert')
  if (method === 'POST' && sessionRevertMatch) {
    const body = await readJsonBody(request)
    return jsonResponse(
      await runtime.revertSession({
        sessionId: sessionRevertMatch.sessionID,
        workspaceRoot: optionalString(body.workspaceRoot) ?? process.cwd(),
        paths: readRequiredStringArray(body.paths, 'paths'),
      }),
    )
  }

  if (method === 'GET' && pathname === '/file') {
    return jsonResponse(
      await runtime.listFileTree({
        workspaceId: requiredQuery(url, 'workspaceId'),
        parentPath:
          optionalQuery(url, 'path') ?? optionalQuery(url, 'parentPath'),
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
      await runtime.getFileStatus({
        workspaceId: requiredQuery(url, 'workspaceId'),
      }),
    )
  }

  if (method === 'GET' && pathname === '/permission') {
    return jsonResponse(
      await runtime.listPendingPermissions({
        sessionId: requiredQuery(url, 'sessionId'),
      }),
    )
  }

  const permissionReplyMatch = matchPath(
    pathname,
    '/permission/:requestID/reply',
  )
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
      await runtime.loadConfig({ workspaceRoot: workspaceRootFromFindQuery(url) }),
    )
  }

  if (method === 'PATCH' && pathname === '/config') {
    const body = await readJsonBody(request)
    return jsonResponse(
      await runtime.updateConfig({
        workspaceRoot: workspaceRootFromFindQuery(url),
        patch: body,
      }),
    )
  }

  if (method === 'GET' && pathname === '/project') {
    return jsonResponse(
      await runtime.listProjects({
        workspaceRoot: workspaceRootFromFindQuery(url),
      }),
    )
  }

  if (method === 'GET' && pathname === '/project/current') {
    const projects = await runtime.listProjects({
      workspaceRoot: workspaceRootFromFindQuery(url),
    })
    return jsonResponse(firstProject(projects))
  }

  if (method === 'GET' && pathname === '/formatter') {
    return jsonResponse(
      await runtime.listFormatterStatus({
        workspaceRoot: workspaceRootFromFindQuery(url),
      }),
    )
  }

  if (method === 'GET' && pathname === '/question') {
    return jsonResponse(
      await runtime.listPendingQuestions({
        sessionId: optionalQuery(url, 'sessionId'),
      }),
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
      await runtime.listProviders({
        workspaceRoot: optionalQuery(url, 'workspaceRoot'),
      }),
    )
  }

  if (method === 'GET' && pathname === '/pty/shells') {
    return jsonResponse(
      await runtime.listPtyShells({
        workspaceRoot: workspaceRootFromFindQuery(url),
      }),
    )
  }

  if (method === 'GET' && pathname === '/pty') {
    return jsonResponse(
      await runtime.listPtySessions({
        workspaceRoot: workspaceRootFromFindQuery(url),
      }),
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
      await runtime.createPtyConnectToken({
        ptySessionId: ptyConnectTokenMatch.ptyID,
      }),
    )
  }

  const ptyConnectMatch = matchPath(pathname, '/pty/:ptyID/connect')
  if (method === 'GET' && ptyConnectMatch) {
    return jsonResponse(
      await runtime.connectPtySession({ ptySessionId: ptyConnectMatch.ptyID }),
    )
  }

  const ptySessionMatch = matchPath(pathname, '/pty/:ptyID')
  if (method === 'GET' && ptySessionMatch) {
    return jsonResponse(
      await runtime.getPtySession({ ptySessionId: ptySessionMatch.ptyID }),
    )
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
    return jsonResponse(
      await runtime.stopPtySession({ ptySessionId: ptySessionMatch.ptyID }),
    )
  }

  if (method === 'GET' && pathname === '/command') {
    return jsonResponse(
      await runtime.listCommands({
        workspaceRoot: workspaceRootFromFindQuery(url),
      }),
    )
  }

  if (method === 'GET' && pathname === '/skill') {
    return jsonResponse(
      await runtime.listSkills({
        workspaceRoot: workspaceRootFromFindQuery(url),
      }),
    )
  }

  if (method === 'GET' && pathname === '/agent') {
    return jsonResponse(
      await runtime.listAgents({
        workspaceRoot: optionalQuery(url, 'workspaceRoot'),
      }),
    )
  }

  return jsonResponse(
    { error: `No OpenCode-compatible route for ${method} ${pathname}` },
    404,
  )
}

const livePtyManager = createPtySessionManager()
const livePtyMetadata = new Map<string, { title?: string; size?: PtySize }>()
const liveMcpServers = new Map<string, Map<string, ApiMcpStatus>>()
const liveSessionStatuses = new Map<
  string,
  { sessionId: string; status: 'idle' | 'running' | 'aborted'; updatedAt: string }
>()

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
    async getSession(input) {
      const runtime = await import('./server-runtime.server')
      return runtime.getSpecterCodeSessionOnServer(input)
    },
    async updateSession(input) {
      const runtime = await import('./server-runtime.server')
      return runtime.updateSpecterCodeSessionOnServer(input)
    },
    async deleteSession(input) {
      const runtime = await import('./server-runtime.server')
      return runtime.deleteSpecterCodeSessionOnServer(input)
    },
    async submitPrompt(input) {
      const runtime = await import('./server-runtime.server')
      liveSessionStatuses.set(input.sessionId, {
        sessionId: input.sessionId,
        status: 'running',
        updatedAt: new Date().toISOString(),
      })
      return runtime.submitSpecterCodePromptOnServer(input)
    },
    async listSessionTranscript(input) {
      const runtime = await import('./server-runtime.server')
      return runtime.listSpecterCodeSessionTranscriptOnServer(input)
    },
    async listSessionStatus() {
      return Object.fromEntries(liveSessionStatuses.entries())
    },
    async createSessionMessage(input) {
      const runtime = await import('./server-runtime.server')
      const session = await runtime.getSpecterCodeSessionOnServer({
        sessionId: input.sessionId,
      })
      if (!isRecord(session)) throw new Error('Session is unavailable')
      liveSessionStatuses.set(input.sessionId, {
        sessionId: input.sessionId,
        status: input.noReply ? 'idle' : 'running',
        updatedAt: new Date().toISOString(),
      })
      const workspaceId = requiredString(session.workspaceId, 'session.workspaceId')
      if (input.noReply) {
        return runtime.recordSpecterCodeSessionMessageOnServer({
          messageId: input.messageId,
          sessionId: input.sessionId,
          workspaceId,
          content: input.content,
          submittedBy: input.submittedBy ?? { displayName: 'OpenCode API' },
        })
      }
      return runtime.submitSpecterCodePromptOnServer({
        messageId: input.messageId,
        sessionId: input.sessionId,
        workspaceId,
        content: input.content,
        agentId: input.agentId,
        agentName: input.agentName ?? input.agentId,
        submittedBy: input.submittedBy ?? { displayName: 'OpenCode API' },
      })
    },
    async abortSession(input) {
      liveSessionStatuses.set(input.sessionId, {
        sessionId: input.sessionId,
        status: 'aborted',
        updatedAt: new Date().toISOString(),
      })
      return true
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
    async listSessionChildren(input) {
      const runtime = await import('./server-runtime.server')
      return runtime.listSpecterCodeSessionChildrenOnServer(input)
    },
    async forkSession(input) {
      const runtime = await import('./server-runtime.server')
      const parent = await runtime.getSpecterCodeSessionOnServer({
        sessionId: input.sessionId,
      })
      if (!isRecord(parent)) throw new Error('Parent session is unavailable')
      const newSessionId = input.newSessionId ?? randomUUID()
      const parentTitle = requiredString(parent.title, 'session.title')
      await runtime.forkSpecterCodeSessionOnServer({
        sessionId: input.sessionId,
        newSessionId,
        workspaceId: requiredString(parent.workspaceId, 'session.workspaceId'),
        title: input.title ?? `Fork of ${parentTitle}`,
        directory: requiredString(parent.directory, 'session.directory'),
        agent: requiredString(parent.agent, 'session.agent'),
        model: readModel(parent.model),
        createdBy: input.createdBy,
      })
      return runtime.getSpecterCodeSessionOnServer({ sessionId: newSessionId })
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
    async updateConfig(input) {
      return updateWorkspaceConfig(input)
    },
    async listProjects(input) {
      return listWorkspaceProjects(input)
    },
    async listFormatterStatus(input) {
      const config = await loadSpecterCodeConfig({
        workspaceRoot: input.workspaceRoot,
      })
      return listFormatterStatuses(config)
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
    async listCommands(input) {
      return listSpecterCodeCommands(input)
    },
    async executeSessionCommand(input) {
      const commands = await listSpecterCodeCommands({ workspaceRoot: input.workspaceRoot })
      const command = commands.find((candidate) => candidate.name === input.command)
      if (!command) throw new Error('Unknown command: ' + input.command)
      const agentId = input.agentId ?? command.agent ?? 'build'
      return this.createSessionMessage({
        sessionId: input.sessionId,
        messageId: input.messageId,
        content: renderSpecterCodeCommandPrompt(command, input.arguments ?? ''),
        agentId,
        agentName: agentId,
        model: input.model ?? readOptionalCommandModel(command.model),
        submittedBy: { displayName: 'OpenCode API' },
      })
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
    async listMcpStatus(input) {
      return liveMcpStatus(input.workspaceRoot)
    },
    async addMcpServer(input) {
      const servers = liveMcpServersFor(input.workspaceRoot)
      servers.set(input.name, {
        type: readMcpConfigType(input.config),
        name: input.name,
        status: 'disconnected',
        config: input.config,
      })
      return liveMcpStatus(input.workspaceRoot)
    },
    async connectMcpServer(input) {
      const server = requireLiveMcpServer(input.workspaceRoot, input.name)
      server.status = 'connected'
      server.error = undefined
      return true
    },
    async disconnectMcpServer(input) {
      const server = requireLiveMcpServer(input.workspaceRoot, input.name)
      server.status = 'disconnected'
      return true
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
    async revertSession(input) {
      return revertWorkspacePaths(input)
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
      if (input.title || input.size)
        livePtyMetadata.set(session.id, {
          title: input.title,
          size: input.size,
        })
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
      return {
        ticket: `pty-${input.ptySessionId}-${randomUUID()}`,
        expires_in: 30,
      }
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
  const session = livePtyManager
    .list()
    .find((candidate) => candidate.id === ptySessionId)
  if (!session) throw new Error('Unknown PTY session: ' + ptySessionId)
  return withPtyMetadata(session)
}

function listAvailableShells(): PtyShellSummary[] {
  const paths = new Set(
    [process.env.SHELL, '/bin/bash', '/bin/sh'].filter(Boolean) as string[],
  )
  return [...paths].map((shellPath) => ({
    path: shellPath,
    name: shellPath.split('/').filter(Boolean).at(-1) ?? shellPath,
    acceptable: true,
  }))
}

function liveMcpServersFor(workspaceRoot: string) {
  const key = workspaceRoot || process.cwd()
  let servers = liveMcpServers.get(key)
  if (!servers) {
    servers = new Map()
    liveMcpServers.set(key, servers)
  }
  return servers
}

function liveMcpStatus(workspaceRoot: string) {
  return Object.fromEntries(liveMcpServersFor(workspaceRoot).entries())
}

function requireLiveMcpServer(workspaceRoot: string, name: string) {
  const server = liveMcpServersFor(workspaceRoot).get(name)
  if (!server) throw new Error('Unknown MCP server: ' + name)
  return server
}

function readMcpConfigType(config: unknown) {
  if (!isRecord(config)) return undefined
  return optionalString(config.type)
}

async function loadConfigForRegistry(workspaceRoot?: string) {
  return loadSpecterCodeConfig({
    workspaceRoot: workspaceRoot ?? process.cwd(),
  })
}



async function updateWorkspaceConfig(input: {
  workspaceRoot: string
  patch: JsonRecord
}) {
  const current = await loadSpecterCodeConfig({ workspaceRoot: input.workspaceRoot })
  const nextRaw = mergeConfigPatch(current.raw, input.patch)
  const configDir = path.join(input.workspaceRoot, '.opencode')
  await mkdir(configDir, { recursive: true })
  await writeFile(
    path.join(configDir, 'opencode.jsonc'),
    `${JSON.stringify(nextRaw, null, 2)}\n`,
    'utf8',
  )
  return loadSpecterCodeConfig({ workspaceRoot: input.workspaceRoot })
}

function mergeConfigPatch(current: JsonRecord, patch: JsonRecord): JsonRecord {
  const next: JsonRecord = { ...current }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete next[key]
      continue
    }
    next[key] = value
  }
  return next
}

async function listWorkspaceProjects(input: {
  workspaceRoot: string
}): Promise<ProjectSummary[]> {
  const config = await loadSpecterCodeConfig({ workspaceRoot: input.workspaceRoot })
  return [
    {
      id: input.workspaceRoot,
      directory: input.workspaceRoot,
      name: path.basename(input.workspaceRoot) || input.workspaceRoot,
      configSources: config.sources,
    },
  ]
}

function listFormatterStatuses(config: SpecterCodeConfig): FormatterStatus[] {
  return formatterStatusesFromValue(config.formatter, 'default')
}

function formatterStatusesFromValue(
  value: unknown,
  fallbackName: string,
): FormatterStatus[] {
  if (value === undefined || value === null || value === false) return []
  if (typeof value === 'string') {
    return [{ name: fallbackName, command: value, enabled: true, status: 'configured' }]
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) =>
      formatterStatusesFromValue(entry, `${fallbackName}-${index + 1}`),
    )
  }
  if (!isRecord(value)) {
    return [{ name: fallbackName, enabled: true, status: 'unsupported' }]
  }

  const command = optionalString(value.command)
  const enabled = value.enabled !== false
  if (command || value.enabled !== undefined) {
    return [
      {
        name: optionalString(value.name) ?? fallbackName,
        command,
        enabled,
        status: enabled ? 'configured' : 'disabled',
      },
    ]
  }

  return Object.entries(value).flatMap(([name, entry]) =>
    formatterStatusesFromValue(entry, name),
  )
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
    if (!isRecord(parsed))
      throw new Error('JSON request body must be an object')
    return parsed
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === 'JSON request body must be an object'
    ) {
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
  return (
    optionalQuery(url, 'directory') ??
    optionalQuery(url, 'workspace') ??
    optionalQuery(url, 'workspaceRoot') ??
    process.cwd()
  )
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
        if (typeof label !== 'string')
          throw new Error('Invalid question answer')
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
  return answers
    .map((answer) => answer.join(', '))
    .filter(Boolean)
    .join(' | ')
}

type PendingQuestionSummary = { questionId: string; sessionId: string }

async function findPendingQuestion(
  questionId: string,
  listQuestions: (input: { sessionId?: string }) => Promise<unknown>,
) {
  const questions = await listQuestions({})
  if (!Array.isArray(questions))
    throw new Error('Pending question list is unavailable')
  const question = questions.find(
    (candidate): candidate is PendingQuestionSummary => {
      return (
        isRecord(candidate) &&
        candidate.questionId === questionId &&
        typeof candidate.sessionId === 'string'
      )
    },
  )
  if (!question) throw new Error(`Pending question not found: ${questionId}`)
  return question
}

function requiredString(value: unknown, name: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Missing required field: ${name}`)
  }
  return value
}

function requiredRecord(value: unknown, name: string) {
  if (!isRecord(value)) throw new Error(`Missing required field: ${name}`)
  return value
}

function readRequiredStringArray(value: unknown, name: string) {
  if (!Array.isArray(value)) throw new Error(`Missing required field: ${name}`)
  const values = value.map((item) => requiredString(item, name))
  if (values.length === 0) throw new Error(`Missing required field: ${name}`)
  return values
}

function optionalString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function readPtySize(value: unknown) {
  if (value === undefined || value === null) return undefined
  if (!isRecord(value)) throw new Error('Invalid PTY size')
  const rows = Number(value.rows)
  const cols = Number(value.cols)
  if (
    !Number.isInteger(rows) ||
    rows <= 0 ||
    !Number.isInteger(cols) ||
    cols <= 0
  ) {
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

function readOptionalCommandModel(model: string | undefined) {
  if (!model) return undefined
  const slash = model.indexOf('/')
  if (slash <= 0 || slash === model.length - 1) return undefined
  return {
    providerId: model.slice(0, slash),
    modelId: model.slice(slash + 1),
  }
}

function readOptionalOpenCodeModel(value: unknown) {
  if (value === undefined || value === null) return undefined
  if (!isRecord(value)) throw new Error('Invalid model')
  return {
    providerId:
      optionalString(value.providerId) ??
      requiredString(value.providerID, 'model.providerID'),
    modelId:
      optionalString(value.modelId) ?? requiredString(value.modelID, 'model.modelID'),
  }
}

function readMessagePartsText(value: unknown) {
  if (!Array.isArray(value)) throw new Error('Missing required field: parts')
  const chunks = value.map((part) => {
    if (!isRecord(part)) throw new Error('Invalid message part')
    if (part.type !== 'text') throw new Error('Only text message parts are supported')
    return requiredString(part.text, 'parts.text')
  })
  const content = chunks.join('\n\n').trim()
  if (!content) throw new Error('Message content is required')
  return content
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

function textResponse(value: string, status = 200) {
  return new Response(value, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })
}

function gitDiffPatch(value: unknown) {
  if (isRecord(value) && typeof value.patch === 'string') return value.patch
  return typeof value === 'string' ? value : ''
}

function firstProject(value: unknown) {
  if (Array.isArray(value)) return value[0] ?? null
  return value
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

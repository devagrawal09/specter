import { randomUUID } from 'node:crypto'
import { lstat, mkdir, rm, writeFile } from 'node:fs/promises'
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
  initGitRepository,
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
import {
  listSpecterCodeToolIds,
  listSpecterCodeTools,
  type OpenCodeToolListItem,
} from './adapters/tool-catalog'
import type { RouteSpec } from './domain/openapi-compat'

export type JsonRecord = Record<string, unknown>
export type OpenCodeLogLevel = 'debug' | 'info' | 'warn' | 'error'
export type OpenCodeSyncEvent = {
  id: string
  aggregate_id: string
  seq: number
  type: string
  data: JsonRecord
}
export type OpenCodeReplaySyncEvent = {
  id: string
  aggregateID: string
  seq: number
  type: string
  data: JsonRecord
}

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

export type ProviderAuthMethod = {
  type: 'oauth' | 'api'
  label: string
  prompts?: readonly JsonRecord[]
}

export type ProviderAuthAuthorization = {
  url: string
  method: 'auto' | 'code'
  instructions: string
}

export type McpAuthStart = {
  authorizationUrl: string
  oauthState: string
}

export type ProjectSummary = {
  id: string
  directory: string
  name: string
  configSources: string[]
  icon?: string
  commands?: JsonRecord
  vcs?: 'git'
  worktree?: string
}

export type FormatterStatus = {
  name: string
  command?: string
  enabled: boolean
  status?: 'configured' | 'disabled' | 'unsupported'
}

export type ExperimentalWorkspaceAdapter = {
  id: string
  name: string
  primary?: boolean
}

export type ExperimentalWorkspaceSummary = {
  id: string
  type: string
  name: string
  directory: string
  branch?: string
  metadata?: JsonRecord
}

export type ExperimentalWorkspaceStatus = {
  id: string
  status: 'ready' | 'syncing' | 'missing'
  directory?: string
  branch?: string
}

export type ExperimentalConsoleState = {
  consoleManagedProviders: string[]
  activeOrgName?: string
  switchableOrgCount: number
}

export type ExperimentalConsoleOrg = {
  accountID: string
  accountEmail: string
  accountUrl: string
  orgID: string
  orgName: string
  active: boolean
}

export type ExperimentalMcpResource = {
  name: string
  uri: string
  description?: string
  mimeType?: string
  client: string
}

export type ExperimentalWorktree = {
  name: string
  branch?: string
  directory: string
}

export type TuiEventPayload = {
  type: string
  properties: JsonRecord
}

export type TuiControlRequest = {
  path: string
  body: unknown
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
  listSessionContext(input: { sessionId: string }): Promise<unknown>
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
  getSessionMessage(input: {
    sessionId: string
    messageId: string
  }): Promise<unknown>
  updateSessionMessagePart(input: {
    sessionId: string
    messageId: string
    partId: string
    text: string
  }): Promise<unknown>
  deleteSessionMessagePart(input: {
    sessionId: string
    messageId: string
    partId: string
  }): Promise<unknown>
  deleteSessionMessage(input: {
    sessionId: string
    messageId: string
  }): Promise<unknown>
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
  updateProject(input: {
    workspaceRoot: string
    projectId: string
    name?: string
    icon?: string
    commands?: JsonRecord
  }): Promise<ProjectSummary | unknown>
  initializeProjectGit(input: {
    workspaceRoot: string
  }): Promise<ProjectSummary | unknown>
  listFormatterStatus(input: {
    workspaceRoot: string
  }): Promise<readonly FormatterStatus[] | unknown>
  listProviders(input?: {
    workspaceRoot?: string
  }): Promise<ProviderSummary[] | unknown>
  listProviderAuthMethods(input: {
    workspaceRoot?: string
  }): Promise<Record<string, readonly ProviderAuthMethod[]> | unknown>
  authorizeProviderOAuth(input: {
    providerId: string
    workspaceRoot?: string
    method: number
    inputs?: Record<string, string>
  }): Promise<ProviderAuthAuthorization | unknown>
  completeProviderOAuth(input: {
    providerId: string
    workspaceRoot?: string
    method: number
    code?: string
  }): Promise<boolean | unknown>
  setProviderAuth(input: {
    providerId: string
    auth: JsonRecord
  }): Promise<boolean | unknown>
  removeProviderAuth(input: { providerId: string }): Promise<boolean | unknown>
  listAgents(input?: {
    workspaceRoot?: string
  }): Promise<AgentSummary[] | unknown>
  listToolIds(input: {
    workspaceRoot: string
  }): Promise<readonly string[] | unknown>
  listTools(input: {
    workspaceRoot: string
    providerId: string
    modelId: string
  }): Promise<readonly OpenCodeToolListItem[] | unknown>
  listExperimentalWorkspaceAdapters?(input: {
    workspaceRoot: string
  }): Promise<readonly ExperimentalWorkspaceAdapter[] | unknown>
  listExperimentalWorkspaces?(input: {
    workspaceRoot: string
  }): Promise<readonly ExperimentalWorkspaceSummary[] | unknown>
  createExperimentalWorkspace?(input: {
    workspaceRoot: string
    workspaceId?: string
    type?: string
    branch?: string
    metadata?: JsonRecord
  }): Promise<ExperimentalWorkspaceSummary | unknown>
  deleteExperimentalWorkspace?(input: {
    workspaceRoot: string
    workspaceId: string
  }): Promise<boolean | unknown>
  syncExperimentalWorkspaceList?(input: {
    workspaceRoot: string
  }): Promise<void>
  getExperimentalWorkspaceStatus?(input: {
    workspaceRoot: string
    workspaceId: string
  }): Promise<ExperimentalWorkspaceStatus | unknown>
  warpExperimentalWorkspace?(input: {
    workspaceRoot: string
    workspaceId: string
    sessionId?: string
    copyChanges?: boolean
  }): Promise<void>
  listExperimentalConsole?(input: {
    workspaceRoot: string
  }): Promise<ExperimentalConsoleState | unknown>
  listExperimentalConsoleOrgs?(input: {
    workspaceRoot: string
  }): Promise<{ orgs: ExperimentalConsoleOrg[] } | unknown>
  switchExperimentalConsoleOrg?(input: {
    workspaceRoot: string
    accountId: string
    orgId: string
  }): Promise<boolean | unknown>
  listExperimentalResources?(input: {
    workspaceRoot: string
  }): Promise<Record<string, ExperimentalMcpResource> | unknown>
  listExperimentalWorktrees?(input: {
    workspaceRoot: string
  }): Promise<readonly string[] | unknown>
  createExperimentalWorktree?(input: {
    workspaceRoot: string
    name?: string
    startCommand?: string
  }): Promise<ExperimentalWorktree | unknown>
  removeExperimentalWorktree?(input: {
    workspaceRoot: string
    directory: string
  }): Promise<boolean | unknown>
  resetExperimentalWorktree?(input: {
    workspaceRoot: string
    directory: string
  }): Promise<boolean | unknown>
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
  initializeSession(input: {
    sessionId: string
    messageId: string
    workspaceRoot: string
    model: { providerId: string; modelId: string }
  }): Promise<boolean | unknown>
  summarizeSession(input: {
    sessionId: string
    workspaceRoot: string
    providerId: string
    modelId: string
    auto?: boolean
  }): Promise<boolean | unknown>
  compactSession(input: {
    sessionId: string
    workspaceRoot: string
  }): Promise<void>
  waitForSession(input: {
    sessionId: string
    workspaceRoot: string
  }): Promise<void>
  runSessionShell(input: {
    sessionId: string
    messageId?: string
    workspaceRoot: string
    agentId: string
    command: string
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
  startMcpAuth(input: {
    workspaceRoot: string
    name: string
  }): Promise<McpAuthStart | unknown>
  authenticateMcp(input: {
    workspaceRoot: string
    name: string
  }): Promise<ApiMcpStatus | unknown>
  completeMcpAuth(input: {
    workspaceRoot: string
    name: string
    code: string
  }): Promise<ApiMcpStatus | unknown>
  removeMcpAuth(input: {
    workspaceRoot: string
    name: string
  }): Promise<{ success: true } | unknown>
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
  shareSession(input: { sessionId: string }): Promise<unknown>
  unshareSession(input: { sessionId: string }): Promise<unknown>
  unrevertSession(input: { sessionId: string }): Promise<unknown>
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
  publishTuiEvent?(input: {
    workspaceRoot: string
    event: TuiEventPayload
  }): Promise<boolean | unknown>
  nextTuiControlRequest?(input: {
    workspaceRoot: string
  }): Promise<TuiControlRequest | unknown>
  submitTuiControlResponse?(input: {
    workspaceRoot: string
    response: unknown
  }): Promise<boolean | unknown>
  disposeGlobal(input: { workspaceRoot?: string }): Promise<boolean | unknown>
  upgradeGlobal(input: {
    target?: string
  }): Promise<
    | { success: true; version: string }
    | { success: false; error: string }
    | unknown
  >
  writeLogEntry(input: {
    service: string
    level: OpenCodeLogLevel
    message: string
    extra?: JsonRecord
  }): Promise<boolean | unknown>
  listSyncHistory(
    input: Record<string, number>,
  ): Promise<readonly OpenCodeSyncEvent[] | unknown>
  replaySyncEvents(input: {
    directory: string
    events: OpenCodeReplaySyncEvent[]
  }): Promise<{ sessionID: string } | unknown>
  startSync(input: { workspaceRoot: string }): Promise<boolean | unknown>
  stealSyncSession(input: {
    sessionId: string
  }): Promise<{ sessionID: string } | unknown>
}

export const INITIAL_OPENCODE_API_ROUTES = [
  { method: 'DELETE', normalizedPath: '/auth/:providerID' },
  { method: 'PUT', normalizedPath: '/auth/:providerID' },
  { method: 'GET', normalizedPath: '/agent' },
  { method: 'GET', normalizedPath: '/api/model' },
  { method: 'GET', normalizedPath: '/api/provider' },
  { method: 'GET', normalizedPath: '/api/provider/:providerID' },
  { method: 'GET', normalizedPath: '/api/session' },
  { method: 'POST', normalizedPath: '/api/session/:sessionID/compact' },
  { method: 'GET', normalizedPath: '/api/session/:sessionID/context' },
  { method: 'GET', normalizedPath: '/api/session/:sessionID/message' },
  { method: 'POST', normalizedPath: '/api/session/:sessionID/prompt' },
  { method: 'POST', normalizedPath: '/api/session/:sessionID/wait' },
  { method: 'GET', normalizedPath: '/config' },
  { method: 'PATCH', normalizedPath: '/config' },
  { method: 'GET', normalizedPath: '/config/providers' },
  { method: 'GET', normalizedPath: '/command' },
  { method: 'GET', normalizedPath: '/event' },
  { method: 'GET', normalizedPath: '/experimental/console' },
  { method: 'GET', normalizedPath: '/experimental/console/orgs' },
  { method: 'POST', normalizedPath: '/experimental/console/switch' },
  { method: 'GET', normalizedPath: '/experimental/resource' },
  { method: 'GET', normalizedPath: '/experimental/session' },
  { method: 'GET', normalizedPath: '/experimental/tool' },
  { method: 'GET', normalizedPath: '/experimental/tool/ids' },
  { method: 'GET', normalizedPath: '/experimental/workspace' },
  { method: 'POST', normalizedPath: '/experimental/workspace' },
  { method: 'GET', normalizedPath: '/experimental/workspace/adapter' },
  { method: 'GET', normalizedPath: '/experimental/workspace/status' },
  { method: 'POST', normalizedPath: '/experimental/workspace/sync-list' },
  { method: 'DELETE', normalizedPath: '/experimental/workspace/:id' },
  { method: 'GET', normalizedPath: '/experimental/workspace/:id/status' },
  { method: 'POST', normalizedPath: '/experimental/workspace/:id/warp' },
  { method: 'POST', normalizedPath: '/experimental/workspace/warp' },
  { method: 'GET', normalizedPath: '/experimental/worktree' },
  { method: 'POST', normalizedPath: '/experimental/worktree' },
  { method: 'DELETE', normalizedPath: '/experimental/worktree' },
  { method: 'POST', normalizedPath: '/experimental/worktree/reset' },
  { method: 'GET', normalizedPath: '/formatter' },
  { method: 'GET', normalizedPath: '/global/config' },
  { method: 'PATCH', normalizedPath: '/global/config' },
  { method: 'GET', normalizedPath: '/global/event' },
  { method: 'GET', normalizedPath: '/global/health' },
  { method: 'POST', normalizedPath: '/global/dispose' },
  { method: 'POST', normalizedPath: '/global/upgrade' },
  { method: 'POST', normalizedPath: '/instance/dispose' },
  { method: 'POST', normalizedPath: '/log' },
  { method: 'POST', normalizedPath: '/sync/history' },
  { method: 'POST', normalizedPath: '/sync/replay' },
  { method: 'POST', normalizedPath: '/sync/start' },
  { method: 'POST', normalizedPath: '/sync/steal' },
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
  { method: 'DELETE', normalizedPath: '/mcp/:name/auth' },
  { method: 'POST', normalizedPath: '/mcp/:name/auth' },
  { method: 'POST', normalizedPath: '/mcp/:name/auth/authenticate' },
  { method: 'POST', normalizedPath: '/mcp/:name/auth/callback' },
  { method: 'GET', normalizedPath: '/path' },
  { method: 'GET', normalizedPath: '/permission' },
  { method: 'POST', normalizedPath: '/permission/:requestID/reply' },
  { method: 'GET', normalizedPath: '/project' },
  { method: 'GET', normalizedPath: '/project/current' },
  { method: 'POST', normalizedPath: '/project/git/init' },
  { method: 'PATCH', normalizedPath: '/project/:projectID' },
  { method: 'GET', normalizedPath: '/provider' },
  { method: 'GET', normalizedPath: '/provider/auth' },
  { method: 'POST', normalizedPath: '/provider/:providerID/oauth/authorize' },
  { method: 'POST', normalizedPath: '/provider/:providerID/oauth/callback' },
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
  { method: 'POST', normalizedPath: '/session/:sessionID/init' },
  { method: 'PATCH', normalizedPath: '/session/:sessionID' },
  { method: 'GET', normalizedPath: '/session/:sessionID/diff' },
  { method: 'GET', normalizedPath: '/session/:sessionID/message' },
  { method: 'GET', normalizedPath: '/session/:sessionID/message/:messageID' },
  {
    method: 'DELETE',
    normalizedPath: '/session/:sessionID/message/:messageID',
  },
  {
    method: 'PATCH',
    normalizedPath: '/session/:sessionID/message/:messageID/part/:partID',
  },
  {
    method: 'DELETE',
    normalizedPath: '/session/:sessionID/message/:messageID/part/:partID',
  },
  {
    method: 'POST',
    normalizedPath: '/session/:sessionID/permissions/:permissionID',
  },
  { method: 'POST', normalizedPath: '/session/:sessionID/prompt_async' },
  { method: 'POST', normalizedPath: '/session/:sessionID/revert' },
  { method: 'POST', normalizedPath: '/session/:sessionID/share' },
  { method: 'DELETE', normalizedPath: '/session/:sessionID/share' },
  { method: 'POST', normalizedPath: '/session/:sessionID/shell' },
  { method: 'POST', normalizedPath: '/session/:sessionID/summarize' },
  { method: 'POST', normalizedPath: '/session/:sessionID/unrevert' },
  { method: 'GET', normalizedPath: '/session/:sessionID/todo' },
  { method: 'POST', normalizedPath: '/tui/append-prompt' },
  { method: 'POST', normalizedPath: '/tui/clear-prompt' },
  { method: 'GET', normalizedPath: '/tui/control/next' },
  { method: 'POST', normalizedPath: '/tui/control/response' },
  { method: 'POST', normalizedPath: '/tui/execute-command' },
  { method: 'POST', normalizedPath: '/tui/open-help' },
  { method: 'POST', normalizedPath: '/tui/open-models' },
  { method: 'POST', normalizedPath: '/tui/open-sessions' },
  { method: 'POST', normalizedPath: '/tui/open-themes' },
  { method: 'POST', normalizedPath: '/tui/publish' },
  { method: 'POST', normalizedPath: '/tui/select-session' },
  { method: 'POST', normalizedPath: '/tui/show-toast' },
  { method: 'POST', normalizedPath: '/tui/submit-prompt' },
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

  const authMatch = matchPath(pathname, '/auth/:providerID')
  if (method === 'PUT' && authMatch) {
    return jsonResponse(
      await runtime.setProviderAuth({
        providerId: authMatch.providerID,
        auth: await readJsonBody(request),
      }),
    )
  }
  if (method === 'DELETE' && authMatch) {
    return jsonResponse(
      await runtime.removeProviderAuth({ providerId: authMatch.providerID }),
    )
  }

  if (method === 'POST' && pathname === '/global/dispose') {
    return jsonResponse(await runtime.disposeGlobal({}))
  }

  if (method === 'POST' && pathname === '/instance/dispose') {
    return jsonResponse(
      await runtime.disposeGlobal({
        workspaceRoot: workspaceRootFromFindQuery(url),
      }),
    )
  }

  if (method === 'POST' && pathname === '/global/upgrade') {
    const body = await readJsonBody(request)
    return jsonResponse(
      await runtime.upgradeGlobal({ target: optionalString(body.target) }),
    )
  }

  if (method === 'POST' && pathname === '/log') {
    const body = await readJsonBody(request)
    return jsonResponse(
      await runtime.writeLogEntry({
        service: requiredString(body.service, 'service'),
        level: readLogLevel(body.level),
        message: requiredString(body.message, 'message'),
        extra: optionalJsonRecord(body.extra),
      }),
    )
  }

  if (method === 'POST' && pathname === '/sync/history') {
    return jsonResponse(
      await runtime.listSyncHistory(
        readSyncHistoryCursor(await readJsonBody(request)),
      ),
    )
  }

  if (method === 'POST' && pathname === '/sync/replay') {
    const body = await readJsonBody(request)
    return jsonResponse(
      await runtime.replaySyncEvents({
        directory: requiredString(body.directory, 'directory'),
        events: readReplaySyncEvents(body.events),
      }),
    )
  }

  if (method === 'POST' && pathname === '/sync/start') {
    return jsonResponse(
      await runtime.startSync({
        workspaceRoot: workspaceRootFromFindQuery(url),
      }),
    )
  }

  if (method === 'POST' && pathname === '/sync/steal') {
    const body = await readJsonBody(request)
    return jsonResponse(
      await runtime.stealSyncSession({
        sessionId: requiredString(body.sessionID, 'sessionID'),
      }),
    )
  }

  if (method === 'GET' && pathname === '/global/event') {
    return createSpecterCodeEventStream({
      loadEvents: (input) => runtime.listEvents(input),
    }).open({
      afterOrder: optionalIntegerQuery(url, 'after'),
      live: optionalQuery(url, 'live') !== 'false',
      signal: request.signal,
    })
  }

  if (method === 'GET' && pathname === '/path') {
    const directory = workspaceRootFromFindQuery(url)
    return jsonResponse({ path: directory, directory })
  }

  if (method === 'GET' && pathname === '/experimental/console') {
    return jsonResponse(
      await experimentalCompatibilityRuntime(runtime).listExperimentalConsole({
        workspaceRoot: workspaceRootFromFindQuery(url),
      }),
    )
  }

  if (method === 'GET' && pathname === '/experimental/console/orgs') {
    return jsonResponse(
      await experimentalCompatibilityRuntime(
        runtime,
      ).listExperimentalConsoleOrgs({
        workspaceRoot: workspaceRootFromFindQuery(url),
      }),
    )
  }

  if (method === 'POST' && pathname === '/experimental/console/switch') {
    const body = await readJsonBody(request)
    return jsonResponse(
      await experimentalCompatibilityRuntime(
        runtime,
      ).switchExperimentalConsoleOrg({
        workspaceRoot: workspaceRootFromFindQuery(url),
        accountId: requiredString(body.accountID, 'accountID'),
        orgId: requiredString(body.orgID, 'orgID'),
      }),
    )
  }

  if (method === 'GET' && pathname === '/experimental/session') {
    return jsonResponse(
      await runtime.listSessions({
        workspaceId: experimentalWorkspaceIdFromQuery(url),
      }),
    )
  }

  if (method === 'GET' && pathname === '/experimental/resource') {
    return jsonResponse(
      await experimentalCompatibilityRuntime(runtime).listExperimentalResources(
        {
          workspaceRoot: workspaceRootFromFindQuery(url),
        },
      ),
    )
  }

  if (method === 'GET' && pathname === '/experimental/worktree') {
    return jsonResponse(
      await experimentalCompatibilityRuntime(runtime).listExperimentalWorktrees(
        {
          workspaceRoot: workspaceRootFromFindQuery(url),
        },
      ),
    )
  }

  if (method === 'POST' && pathname === '/experimental/worktree') {
    const body = await readJsonBody(request)
    return jsonResponse(
      await experimentalCompatibilityRuntime(
        runtime,
      ).createExperimentalWorktree({
        workspaceRoot: workspaceRootFromFindQuery(url),
        name: optionalString(body.name),
        startCommand: optionalString(body.startCommand),
      }),
    )
  }

  if (method === 'DELETE' && pathname === '/experimental/worktree') {
    const body = await readJsonBody(request)
    return jsonResponse(
      await experimentalCompatibilityRuntime(
        runtime,
      ).removeExperimentalWorktree({
        workspaceRoot: workspaceRootFromFindQuery(url),
        directory: requiredString(body.directory, 'directory'),
      }),
    )
  }

  if (method === 'POST' && pathname === '/experimental/worktree/reset') {
    const body = await readJsonBody(request)
    return jsonResponse(
      await experimentalCompatibilityRuntime(runtime).resetExperimentalWorktree(
        {
          workspaceRoot: workspaceRootFromFindQuery(url),
          directory: requiredString(body.directory, 'directory'),
        },
      ),
    )
  }

  if (method === 'GET' && pathname === '/experimental/tool/ids') {
    return jsonResponse(
      await runtime.listToolIds({
        workspaceRoot: workspaceRootFromFindQuery(url),
      }),
    )
  }

  if (method === 'GET' && pathname === '/experimental/tool') {
    return jsonResponse(
      await runtime.listTools({
        workspaceRoot: workspaceRootFromFindQuery(url),
        providerId: requiredQuery(url, 'provider'),
        modelId: requiredQuery(url, 'model'),
      }),
    )
  }

  if (method === 'GET' && pathname === '/experimental/workspace/adapter') {
    return jsonResponse(
      await experimentalWorkspaceRuntime(
        runtime,
      ).listExperimentalWorkspaceAdapters({
        workspaceRoot: workspaceRootFromFindQuery(url),
      }),
    )
  }

  if (method === 'GET' && pathname === '/experimental/workspace') {
    return jsonResponse(
      await experimentalWorkspaceRuntime(runtime).listExperimentalWorkspaces({
        workspaceRoot: workspaceRootFromFindQuery(url),
      }),
    )
  }

  if (method === 'POST' && pathname === '/experimental/workspace') {
    const body = await readJsonBody(request)
    return jsonResponse(
      await experimentalWorkspaceRuntime(runtime).createExperimentalWorkspace({
        workspaceRoot: workspaceRootFromFindQuery(url),
        workspaceId:
          optionalString(body.id) ??
          optionalString(body.workspaceID) ??
          optionalString(body.workspaceId),
        type: optionalString(body.type),
        branch: optionalString(body.branch),
        metadata: optionalJsonRecord(body.metadata),
      }),
    )
  }

  if (method === 'POST' && pathname === '/experimental/workspace/sync-list') {
    await experimentalWorkspaceRuntime(runtime).syncExperimentalWorkspaceList({
      workspaceRoot: workspaceRootFromFindQuery(url),
    })
    return noContentResponse()
  }

  if (method === 'GET' && pathname === '/experimental/workspace/status') {
    if (!runtime.getExperimentalWorkspaceStatus) {
      throw new Error('Experimental workspace status runtime is unavailable')
    }
    return jsonResponse(
      await runtime.getExperimentalWorkspaceStatus({
        workspaceRoot: workspaceRootFromFindQuery(url),
        workspaceId: experimentalWorkspaceIdFromQuery(url),
      }),
    )
  }

  if (method === 'POST' && pathname === '/experimental/workspace/warp') {
    if (!runtime.warpExperimentalWorkspace) {
      throw new Error('Experimental workspace warp runtime is unavailable')
    }
    const body = await readJsonBody(request)
    await runtime.warpExperimentalWorkspace({
      workspaceRoot: workspaceRootFromFindQuery(url),
      workspaceId:
        optionalString(body.id) ??
        optionalString(body.workspaceID) ??
        optionalString(body.workspaceId) ??
        experimentalWorkspaceIdFromQuery(url),
      sessionId:
        optionalString(body.sessionID) ?? optionalString(body.sessionId),
      copyChanges: optionalBoolean(body.copyChanges) ?? false,
    })
    return noContentResponse()
  }

  const experimentalWorkspaceMatch = matchPath(
    pathname,
    '/experimental/workspace/:id',
  )
  if (method === 'DELETE' && experimentalWorkspaceMatch) {
    return jsonResponse(
      await experimentalWorkspaceRuntime(runtime).deleteExperimentalWorkspace({
        workspaceRoot: workspaceRootFromFindQuery(url),
        workspaceId: experimentalWorkspaceMatch.id,
      }),
    )
  }

  const experimentalWorkspaceStatusMatch = matchPath(
    pathname,
    '/experimental/workspace/:id/status',
  )
  if (method === 'GET' && experimentalWorkspaceStatusMatch) {
    return jsonResponse(
      await experimentalWorkspaceRuntime(
        runtime,
      ).getExperimentalWorkspaceStatus({
        workspaceRoot: workspaceRootFromFindQuery(url),
        workspaceId: experimentalWorkspaceStatusMatch.id,
      }),
    )
  }

  const experimentalWorkspaceWarpMatch = matchPath(
    pathname,
    '/experimental/workspace/:id/warp',
  )
  if (method === 'POST' && experimentalWorkspaceWarpMatch) {
    await experimentalWorkspaceRuntime(runtime).warpExperimentalWorkspace({
      workspaceRoot: workspaceRootFromFindQuery(url),
      workspaceId: experimentalWorkspaceWarpMatch.id,
    })
    return noContentResponse()
  }

  if (
    method === 'GET' &&
    (pathname === '/api/provider' || pathname === '/api/model')
  ) {
    return jsonResponse(
      await runtime.listProviders({
        workspaceRoot: optionalQuery(url, 'workspaceRoot'),
      }),
    )
  }

  const apiProviderMatch = matchPath(pathname, '/api/provider/:providerID')
  if (method === 'GET' && apiProviderMatch) {
    const providers = await runtime.listProviders({
      workspaceRoot: optionalQuery(url, 'workspaceRoot'),
    })
    return jsonResponse(providerById(providers, apiProviderMatch.providerID))
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
  const apiSessionMessageMatch = matchPath(
    pathname,
    '/api/session/:sessionID/message',
  )
  const transcriptMatch = sessionMessageMatch ?? apiSessionMessageMatch
  if (method === 'GET' && transcriptMatch) {
    return jsonResponse(
      await runtime.listSessionTranscript({
        sessionId: transcriptMatch.sessionID,
      }),
    )
  }

  const sessionMessageDetailMatch = matchPath(
    pathname,
    '/session/:sessionID/message/:messageID',
  )
  if (method === 'GET' && sessionMessageDetailMatch) {
    return jsonResponse(
      await runtime.getSessionMessage({
        sessionId: sessionMessageDetailMatch.sessionID,
        messageId: sessionMessageDetailMatch.messageID,
      }),
    )
  }

  if (method === 'DELETE' && sessionMessageDetailMatch) {
    return jsonResponse(
      await runtime.deleteSessionMessage({
        sessionId: sessionMessageDetailMatch.sessionID,
        messageId: sessionMessageDetailMatch.messageID,
      }),
    )
  }

  const sessionMessagePartMatch = matchPath(
    pathname,
    '/session/:sessionID/message/:messageID/part/:partID',
  )
  if (method === 'PATCH' && sessionMessagePartMatch) {
    const body = await readJsonBody(request)
    return jsonResponse(
      await runtime.updateSessionMessagePart({
        sessionId: sessionMessagePartMatch.sessionID,
        messageId: sessionMessagePartMatch.messageID,
        partId: sessionMessagePartMatch.partID,
        text: readMessagePartPatchText(body),
      }),
    )
  }

  if (method === 'DELETE' && sessionMessagePartMatch) {
    return jsonResponse(
      await runtime.deleteSessionMessagePart({
        sessionId: sessionMessagePartMatch.sessionID,
        messageId: sessionMessagePartMatch.messageID,
        partId: sessionMessagePartMatch.partID,
      }),
    )
  }

  if (method === 'POST' && sessionMessageMatch) {
    const body = await readJsonBody(request)
    const agentId = optionalString(body.agent) ?? 'build'
    return jsonResponse(
      await runtime.createSessionMessage({
        sessionId: sessionMessageMatch.sessionID,
        messageId:
          optionalString(body.messageID) ?? optionalString(body.messageId),
        content: readMessagePartsText(body.parts),
        agentId,
        agentName: optionalString(body.agentName) ?? agentId,
        model: readOptionalOpenCodeModel(body.model),
        noReply: optionalBoolean(body.noReply),
        submittedBy: readActor(body.submittedBy) ?? {
          displayName: 'OpenCode API',
        },
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
        messageId:
          optionalString(body.messageID) ?? optionalString(body.messageId),
        workspaceRoot: workspaceRootFromFindQuery(url),
        command: requiredString(body.command ?? body.name, 'command'),
        arguments:
          optionalString(body.arguments) ?? optionalString(body.argument),
        agentId: optionalString(body.agent),
        model: readOptionalOpenCodeModel(body.model),
      }),
    )
  }

  const sessionInitMatch = matchPath(pathname, '/session/:sessionID/init')
  if (method === 'POST' && sessionInitMatch) {
    const body = await readJsonBody(request)
    return jsonResponse(
      await runtime.initializeSession({
        sessionId: sessionInitMatch.sessionID,
        messageId:
          optionalString(body.messageID) ??
          requiredString(body.messageId, 'messageID'),
        workspaceRoot: workspaceRootFromFindQuery(url),
        model: readOpenCodeBodyModel(body),
      }),
    )
  }

  const sessionSummarizeMatch = matchPath(
    pathname,
    '/session/:sessionID/summarize',
  )
  if (method === 'POST' && sessionSummarizeMatch) {
    const body = await readJsonBody(request)
    const model = readOpenCodeBodyModel(body)
    return jsonResponse(
      await runtime.summarizeSession({
        sessionId: sessionSummarizeMatch.sessionID,
        workspaceRoot: workspaceRootFromFindQuery(url),
        providerId: model.providerId,
        modelId: model.modelId,
        auto: optionalBoolean(body.auto),
      }),
    )
  }

  const sessionShellMatch = matchPath(pathname, '/session/:sessionID/shell')
  if (method === 'POST' && sessionShellMatch) {
    const body = await readJsonBody(request)
    return jsonResponse(
      await runtime.runSessionShell({
        sessionId: sessionShellMatch.sessionID,
        messageId:
          optionalString(body.messageID) ?? optionalString(body.messageId),
        workspaceRoot: workspaceRootFromFindQuery(url),
        agentId: requiredString(body.agent, 'agent'),
        command: requiredString(body.command, 'command'),
        model: readOptionalOpenCodeModel(body.model),
      }),
    )
  }

  const apiCompactMatch = matchPath(pathname, '/api/session/:sessionID/compact')
  if (method === 'POST' && apiCompactMatch) {
    await runtime.compactSession({
      sessionId: apiCompactMatch.sessionID,
      workspaceRoot: workspaceRootFromFindQuery(url),
    })
    return noContentResponse()
  }

  const apiWaitMatch = matchPath(pathname, '/api/session/:sessionID/wait')
  if (method === 'POST' && apiWaitMatch) {
    await runtime.waitForSession({
      sessionId: apiWaitMatch.sessionID,
      workspaceRoot: workspaceRootFromFindQuery(url),
    })
    return noContentResponse()
  }

  const apiContextMatch = matchPath(pathname, '/api/session/:sessionID/context')
  if (method === 'GET' && apiContextMatch) {
    return jsonResponse(
      await runtime.listSessionContext({
        sessionId: apiContextMatch.sessionID,
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

  const sessionChildrenMatch = matchPath(
    pathname,
    '/session/:sessionID/children',
  )
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
        newSessionId:
          optionalString(body.sessionId) ?? optionalString(body.newSessionId),
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
        content:
          optionalString(body.content) ?? readMessagePartsText(body.parts),
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

  const mcpAuthMatch = matchPath(pathname, '/mcp/:name/auth')
  if (method === 'POST' && mcpAuthMatch) {
    return jsonResponse(
      await runtime.startMcpAuth({
        workspaceRoot: workspaceRootFromFindQuery(url),
        name: mcpAuthMatch.name,
      }),
    )
  }
  if (method === 'DELETE' && mcpAuthMatch) {
    return jsonResponse(
      await runtime.removeMcpAuth({
        workspaceRoot: workspaceRootFromFindQuery(url),
        name: mcpAuthMatch.name,
      }),
    )
  }

  const mcpAuthAuthenticateMatch = matchPath(
    pathname,
    '/mcp/:name/auth/authenticate',
  )
  if (method === 'POST' && mcpAuthAuthenticateMatch) {
    return jsonResponse(
      await runtime.authenticateMcp({
        workspaceRoot: workspaceRootFromFindQuery(url),
        name: mcpAuthAuthenticateMatch.name,
      }),
    )
  }

  const mcpAuthCallbackMatch = matchPath(pathname, '/mcp/:name/auth/callback')
  if (method === 'POST' && mcpAuthCallbackMatch) {
    const body = await readJsonBody(request)
    return jsonResponse(
      await runtime.completeMcpAuth({
        workspaceRoot: workspaceRootFromFindQuery(url),
        name: mcpAuthCallbackMatch.name,
        code: requiredString(body.code, 'code'),
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

  const sessionShareMatch = matchPath(pathname, '/session/:sessionID/share')
  if (method === 'POST' && sessionShareMatch) {
    return jsonResponse(
      await runtime.shareSession({ sessionId: sessionShareMatch.sessionID }),
    )
  }

  if (method === 'DELETE' && sessionShareMatch) {
    return jsonResponse(
      await runtime.unshareSession({ sessionId: sessionShareMatch.sessionID }),
    )
  }

  const sessionUnrevertMatch = matchPath(
    pathname,
    '/session/:sessionID/unrevert',
  )
  if (method === 'POST' && sessionUnrevertMatch) {
    return jsonResponse(
      await runtime.unrevertSession({
        sessionId: sessionUnrevertMatch.sessionID,
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

  const sessionPermissionReplyMatch = matchPath(
    pathname,
    '/session/:sessionID/permissions/:permissionID',
  )
  if (method === 'POST' && sessionPermissionReplyMatch) {
    const body = await readJsonBody(request)
    const response = readOpenCodePermissionResponse(body.response)
    return jsonResponse(
      await runtime.replyPermission({
        requestId: sessionPermissionReplyMatch.permissionID,
        sessionId: sessionPermissionReplyMatch.sessionID,
        action: response === 'reject' ? 'deny' : 'allow',
        repliedBy: { displayName: 'OpenCode API' },
        reason: `OpenCode permission response: ${response}`,
      }),
    )
  }

  if (
    method === 'GET' &&
    (pathname === '/config' || pathname === '/global/config')
  ) {
    return jsonResponse(
      await runtime.loadConfig({
        workspaceRoot: workspaceRootFromFindQuery(url),
      }),
    )
  }

  if (
    method === 'PATCH' &&
    (pathname === '/config' || pathname === '/global/config')
  ) {
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

  if (method === 'POST' && pathname === '/project/git/init') {
    return jsonResponse(
      await runtime.initializeProjectGit({
        workspaceRoot: workspaceRootFromFindQuery(url),
      }),
    )
  }

  const projectUpdateMatch = matchPath(pathname, '/project/:projectID')
  if (method === 'PATCH' && projectUpdateMatch) {
    const body = await readJsonBody(request)
    return jsonResponse(
      await runtime.updateProject({
        workspaceRoot: workspaceRootFromFindQuery(url),
        projectId: projectUpdateMatch.projectID,
        name: optionalString(body.name),
        icon: optionalString(body.icon),
        commands: optionalJsonRecord(body.commands),
      }),
    )
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

  if (method === 'GET' && pathname === '/provider/auth') {
    return jsonResponse(
      await runtime.listProviderAuthMethods({
        workspaceRoot: workspaceRootFromFindQuery(url),
      }),
    )
  }

  const providerAuthorizeMatch = matchPath(
    pathname,
    '/provider/:providerID/oauth/authorize',
  )
  if (method === 'POST' && providerAuthorizeMatch) {
    const body = await readJsonBody(request)
    return jsonResponse(
      await runtime.authorizeProviderOAuth({
        providerId: providerAuthorizeMatch.providerID,
        workspaceRoot: workspaceRootFromFindQuery(url),
        method: requiredNumber(body.method, 'method'),
        inputs: optionalStringRecord(body.inputs),
      }),
    )
  }

  const providerCallbackMatch = matchPath(
    pathname,
    '/provider/:providerID/oauth/callback',
  )
  if (method === 'POST' && providerCallbackMatch) {
    const body = await readJsonBody(request)
    return jsonResponse(
      await runtime.completeProviderOAuth({
        providerId: providerCallbackMatch.providerID,
        workspaceRoot: workspaceRootFromFindQuery(url),
        method: requiredNumber(body.method, 'method'),
        code: optionalString(body.code),
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

  if (method === 'GET' && pathname === '/tui/control/next') {
    return jsonResponse(
      await requireTuiRuntime(runtime).nextTuiControlRequest({
        workspaceRoot: workspaceRootFromFindQuery(url),
      }),
    )
  }

  if (method === 'POST' && pathname === '/tui/control/response') {
    const body = await readJsonBody(request)
    return jsonResponse(
      await requireTuiRuntime(runtime).submitTuiControlResponse({
        workspaceRoot: workspaceRootFromFindQuery(url),
        response: body,
      }),
    )
  }

  const tuiEvent = await readTuiEventRoute(method, pathname, request)
  if (tuiEvent) {
    return jsonResponse(
      await requireTuiRuntime(runtime).publishTuiEvent({
        workspaceRoot: workspaceRootFromFindQuery(url),
        event: tuiEvent,
      }),
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
const liveProviderAuth = new Map<string, JsonRecord>()
const liveSessionShares = new Map<string, { url: string }>()
const liveSessionStatuses = new Map<
  string,
  {
    sessionId: string
    status: 'idle' | 'running' | 'aborted'
    updatedAt: string
  }
>()
const liveExperimentalWorkspaces = new Map<
  string,
  ExperimentalWorkspaceSummary[]
>()
const liveExperimentalWorkspaceActive = new Map<string, string>()
const liveExperimentalConsoleActiveOrg = new Map<
  string,
  { accountId: string; orgId: string }
>()
const liveExperimentalWorktrees = new Map<string, ExperimentalWorktree[]>()
const liveTuiEvents = new Map<string, TuiEventPayload[]>()
const liveTuiControlQueues = new Map<
  string,
  {
    requests: TuiControlRequest[]
    requestWaiters: ((request: TuiControlRequest) => void)[]
    responses: unknown[]
  }
>()

function createLiveRuntime(): SpecterCodeApiRuntime {
  return {
    async listSessions(input) {
      const runtime = await import('./server-runtime.server')
      return runtime.listSpecterCodeSessionsOnServer(input)
    },
    async createSession(input) {
      const runtime = await import('./server-runtime.server')
      const sessionId = input.sessionId ?? randomUUID()
      await runtime.createSpecterCodeSessionOnServer({ ...input, sessionId })
      return runtime.getSpecterCodeSessionOnServer({ sessionId })
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
      const messageId = input.messageId ?? randomUUID()
      const runId = input.runId ?? randomUUID()
      liveSessionStatuses.set(input.sessionId, {
        sessionId: input.sessionId,
        status: 'running',
        updatedAt: new Date().toISOString(),
      })
      return runtime.submitSpecterCodePromptOnServer({
        ...input,
        messageId,
        runId,
      })
    },
    async listSessionTranscript(input) {
      const runtime = await import('./server-runtime.server')
      return runtime.listSpecterCodeSessionTranscriptOnServer(input)
    },
    async listSessionContext(input) {
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
      const workspaceId = requiredString(
        session.workspaceId,
        'session.workspaceId',
      )
      if (input.noReply) {
        const messageId = input.messageId ?? randomUUID()
        await runtime.recordSpecterCodeSessionMessageOnServer({
          messageId,
          sessionId: input.sessionId,
          workspaceId,
          content: input.content,
          submittedBy: input.submittedBy ?? { displayName: 'OpenCode API' },
        })
        const message = await runtime.getSpecterCodeSessionMessageOnServer({
          sessionId: input.sessionId,
          messageId,
        })
        return toOpenCodeMessageDetail(message)
      }
      return runtime.submitSpecterCodePromptOnServer({
        messageId: input.messageId ?? randomUUID(),
        runId: randomUUID(),
        sessionId: input.sessionId,
        workspaceId,
        content: input.content,
        agentId: input.agentId,
        agentName: input.agentName ?? input.agentId,
        submittedBy: input.submittedBy ?? { displayName: 'OpenCode API' },
      })
    },
    async getSessionMessage(input) {
      const runtime = await import('./server-runtime.server')
      const message = await runtime.getSpecterCodeSessionMessageOnServer(input)
      return toOpenCodeMessageDetail(message)
    },
    async updateSessionMessagePart(input) {
      const runtime = await import('./server-runtime.server')
      const message =
        await runtime.updateSpecterCodeSessionMessagePartOnServer(input)
      return toOpenCodeMessageDetail(message)
    },
    async deleteSessionMessagePart(input) {
      const runtime = await import('./server-runtime.server')
      const message =
        await runtime.deleteSpecterCodeSessionMessagePartOnServer(input)
      return toOpenCodeMessageDetail(message)
    },
    async deleteSessionMessage(input) {
      const runtime = await import('./server-runtime.server')
      return runtime.deleteSpecterCodeSessionMessageOnServer(input)
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
      await runtime.replySpecterCodeToolApprovalOnServer(input)
      return true
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
    async updateProject(input) {
      return updateWorkspaceProject(input)
    },
    async initializeProjectGit(input) {
      return initializeWorkspaceGitProject(input)
    },
    async listExperimentalWorkspaceAdapters(input) {
      return listExperimentalWorkspaceAdapters(input)
    },
    async listExperimentalWorkspaces(input) {
      return listExperimentalWorkspaces(input)
    },
    async createExperimentalWorkspace(input) {
      return createExperimentalWorkspace(input)
    },
    async deleteExperimentalWorkspace(input) {
      return deleteExperimentalWorkspace(input)
    },
    async syncExperimentalWorkspaceList(input) {
      await syncExperimentalWorkspaceList(input)
    },
    async getExperimentalWorkspaceStatus(input) {
      return getExperimentalWorkspaceStatus(input)
    },
    async warpExperimentalWorkspace(input) {
      await warpExperimentalWorkspace(input)
    },
    async listExperimentalConsole(input) {
      return listExperimentalConsole(input)
    },
    async listExperimentalConsoleOrgs(input) {
      return listExperimentalConsoleOrgs(input)
    },
    async switchExperimentalConsoleOrg(input) {
      return switchExperimentalConsoleOrg(input)
    },
    async listExperimentalResources(input) {
      return listExperimentalResources(input)
    },
    async listExperimentalWorktrees(input) {
      return listExperimentalWorktrees(input)
    },
    async createExperimentalWorktree(input) {
      return createExperimentalWorktree(input)
    },
    async removeExperimentalWorktree(input) {
      return removeExperimentalWorktree(input)
    },
    async resetExperimentalWorktree(input) {
      return resetExperimentalWorktree(input)
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
    async listProviderAuthMethods(input) {
      const providers = await this.listProviders({
        workspaceRoot: input.workspaceRoot,
      })
      return providerAuthMethodsFor(providers)
    },
    async authorizeProviderOAuth(input) {
      return {
        url: createProviderOauthUrl(
          input.providerId,
          input.method,
          input.inputs,
        ),
        method: 'code',
        instructions:
          'Open the URL, authorize the provider, then paste the returned code.',
      }
    },
    async completeProviderOAuth(input) {
      liveProviderAuth.set(input.providerId, {
        type: 'oauth',
        method: input.method,
        code: input.code ?? '',
        updatedAt: new Date().toISOString(),
      })
      return true
    },
    async setProviderAuth(input) {
      liveProviderAuth.set(input.providerId, input.auth)
      return true
    },
    async removeProviderAuth(input) {
      liveProviderAuth.delete(input.providerId)
      return true
    },
    async listAgents(input) {
      const config = await loadConfigForRegistry(input?.workspaceRoot)
      return createAgentRegistry({ config }).listAgents()
    },
    async listToolIds() {
      return listSpecterCodeToolIds()
    },
    async listTools() {
      return listSpecterCodeTools()
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
      const commands = await listSpecterCodeCommands({
        workspaceRoot: input.workspaceRoot,
      })
      const command = commands.find(
        (candidate) => candidate.name === input.command,
      )
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
    async initializeSession(input) {
      await this.createSessionMessage({
        sessionId: input.sessionId,
        messageId: input.messageId,
        content: [
          'Initialize this project for Specter Code.',
          `Analyze the workspace at ${input.workspaceRoot}.`,
          'Create or update AGENTS.md with project-specific build, test, and coding-agent guidance.',
        ].join('\n\n'),
        agentId: 'build',
        agentName: 'build',
        model: input.model,
        submittedBy: { displayName: 'OpenCode API' },
      })
      return true
    },
    async summarizeSession(input) {
      await this.createSessionMessage({
        sessionId: input.sessionId,
        content: input.auto
          ? 'Automatically compact and summarize this session, preserving goals, decisions, changed files, commands, and next steps.'
          : 'Summarize this session, preserving goals, decisions, changed files, commands, and next steps.',
        agentId: 'build',
        agentName: 'build',
        model: { providerId: input.providerId, modelId: input.modelId },
        submittedBy: { displayName: 'OpenCode API' },
      })
      return true
    },
    async compactSession(input) {
      const session = await this.getSession({ sessionId: input.sessionId })
      if (!isRecord(session)) throw new Error('Session is unavailable')
      const model = readModel(session.model)
      await this.summarizeSession({
        sessionId: input.sessionId,
        workspaceRoot: input.workspaceRoot,
        providerId: model.providerId,
        modelId: model.modelId,
        auto: true,
      })
    },
    async waitForSession(input) {
      liveSessionStatuses.set(input.sessionId, {
        sessionId: input.sessionId,
        status: 'idle',
        updatedAt: new Date().toISOString(),
      })
    },
    async runSessionShell(input) {
      return this.createSessionMessage({
        sessionId: input.sessionId,
        messageId: input.messageId,
        content: `Run this shell command and report the result:

\`\`\`sh
${input.command}
\`\`\``,
        agentId: input.agentId,
        agentName: input.agentId,
        model: input.model,
        submittedBy: { displayName: 'OpenCode API' },
      })
    },
    async disposeGlobal() {
      return true
    },
    async upgradeGlobal(input) {
      return {
        success: false,
        error: input.target
          ? `Specter Code is managed externally; cannot upgrade to ${input.target}`
          : 'Specter Code is managed externally; cannot self-upgrade',
      }
    },
    async writeLogEntry(input) {
      const writer =
        input.level === 'error'
          ? console.error
          : input.level === 'warn'
            ? console.warn
            : console.log
      writer(
        `[${input.service}] ${input.level}: ${input.message}`,
        input.extra ?? {},
      )
      return true
    },
    async listSyncHistory(input) {
      const events = await this.listEvents({
        afterOrder: smallestSyncCursor(input),
      })
      return events.map(toOpenCodeSyncEvent)
    },
    async replaySyncEvents(input) {
      const sessionId = input.events.find(
        (event) => event.aggregateID,
      )?.aggregateID
      return { sessionID: sessionId ?? input.directory }
    },
    async startSync() {
      return true
    },
    async stealSyncSession(input) {
      return { sessionID: input.sessionId }
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
    async startMcpAuth(input) {
      const server = requireLiveMcpServer(input.workspaceRoot, input.name)
      server.status = 'disconnected'
      return {
        authorizationUrl: createMcpOauthUrl(input.name),
        oauthState: `specter-mcp-${input.name}`,
      }
    },
    async authenticateMcp(input) {
      const server = requireLiveMcpServer(input.workspaceRoot, input.name)
      server.status = 'connected'
      server.error = undefined
      return server
    },
    async completeMcpAuth(input) {
      const server = requireLiveMcpServer(input.workspaceRoot, input.name)
      server.status = 'connected'
      server.error = undefined
      server.config = {
        ...(isRecord(server.config) ? server.config : {}),
        oauthCode: input.code,
      }
      return server
    },
    async removeMcpAuth(input) {
      const server = requireLiveMcpServer(input.workspaceRoot, input.name)
      if (isRecord(server.config)) {
        const { oauthCode: _removed, ...rest } = server.config
        server.config = rest
      }
      return { success: true }
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
    async shareSession(input) {
      const session = await this.getSession({ sessionId: input.sessionId })
      if (!isRecord(session)) throw new Error('Session is unavailable')
      const share = liveSessionShares.get(input.sessionId) ?? {
        url: createSessionShareUrl(input.sessionId),
      }
      liveSessionShares.set(input.sessionId, share)
      return { ...session, share }
    },
    async unshareSession(input) {
      const session = await this.getSession({ sessionId: input.sessionId })
      if (!isRecord(session)) throw new Error('Session is unavailable')
      liveSessionShares.delete(input.sessionId)
      return { ...session, share: undefined }
    },
    async unrevertSession(input) {
      const session = await this.getSession({ sessionId: input.sessionId })
      if (!isRecord(session)) throw new Error('Session is unavailable')
      return { ...session, reverted: false }
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
    async publishTuiEvent(input) {
      liveTuiEventsFor(input.workspaceRoot).push(input.event)
      return true
    },
    async nextTuiControlRequest(input) {
      return nextLiveTuiControlRequest(input.workspaceRoot)
    },
    async submitTuiControlResponse(input) {
      liveTuiControlQueueFor(input.workspaceRoot).responses.push(input.response)
      return true
    },
  }
}

const tuiCommandAliases: Record<string, string> = {
  session_new: 'session.new',
  session_share: 'session.share',
  session_interrupt: 'session.interrupt',
  session_compact: 'session.compact',
  messages_page_up: 'session.page.up',
  messages_page_down: 'session.page.down',
  messages_line_up: 'session.line.up',
  messages_line_down: 'session.line.down',
  messages_half_page_up: 'session.half.page.up',
  messages_half_page_down: 'session.half.page.down',
  messages_first: 'session.first',
  messages_last: 'session.last',
  agent_cycle: 'agent.cycle',
}

async function readTuiEventRoute(
  method: string,
  pathname: string,
  request: Request,
): Promise<TuiEventPayload | undefined> {
  if (method !== 'POST') return undefined
  if (pathname === '/tui/open-help') return tuiCommandEvent('help.show')
  if (pathname === '/tui/open-sessions') return tuiCommandEvent('session.list')
  if (pathname === '/tui/open-themes') return tuiCommandEvent('session.list')
  if (pathname === '/tui/open-models') return tuiCommandEvent('model.list')
  if (pathname === '/tui/submit-prompt') return tuiCommandEvent('prompt.submit')
  if (pathname === '/tui/clear-prompt') return tuiCommandEvent('prompt.clear')
  const body = await readJsonBody(request)
  if (pathname === '/tui/append-prompt') {
    return { type: 'tui.prompt.append', properties: body }
  }
  if (pathname === '/tui/execute-command') {
    return tuiCommandEvent(
      tuiCommandAliases[requiredString(body.command, 'command')],
    )
  }
  if (pathname === '/tui/show-toast') {
    return { type: 'tui.toast.show', properties: body }
  }
  if (pathname === '/tui/select-session') {
    return { type: 'tui.session.select', properties: body }
  }
  if (pathname === '/tui/publish') {
    return {
      type: requiredString(body.type, 'type'),
      properties: readTuiProperties(body.properties),
    }
  }
  return undefined
}

function tuiCommandEvent(command: string | undefined): TuiEventPayload {
  const properties: JsonRecord = {}
  if (command !== undefined) properties.command = command
  return { type: 'tui.command.execute', properties }
}

function readTuiProperties(value: unknown): JsonRecord {
  if (value === undefined) return {}
  if (!isRecord(value)) throw new Error('Invalid TUI event properties')
  return value
}

function requireTuiRuntime(
  runtime: SpecterCodeApiRuntime,
): Required<
  Pick<
    SpecterCodeApiRuntime,
    'publishTuiEvent' | 'nextTuiControlRequest' | 'submitTuiControlResponse'
  >
> {
  if (
    !runtime.publishTuiEvent ||
    !runtime.nextTuiControlRequest ||
    !runtime.submitTuiControlResponse
  ) {
    throw new Error('TUI runtime is unavailable')
  }
  return {
    publishTuiEvent: runtime.publishTuiEvent.bind(runtime),
    nextTuiControlRequest: runtime.nextTuiControlRequest.bind(runtime),
    submitTuiControlResponse: runtime.submitTuiControlResponse.bind(runtime),
  }
}

function liveTuiEventsFor(workspaceRoot: string) {
  const key = workspaceRoot || process.cwd()
  let events = liveTuiEvents.get(key)
  if (!events) {
    events = []
    liveTuiEvents.set(key, events)
  }
  return events
}

function liveTuiControlQueueFor(workspaceRoot: string) {
  const key = workspaceRoot || process.cwd()
  let queue = liveTuiControlQueues.get(key)
  if (!queue) {
    queue = { requests: [], requestWaiters: [], responses: [] }
    liveTuiControlQueues.set(key, queue)
  }
  return queue
}

function nextLiveTuiControlRequest(workspaceRoot: string) {
  const queue = liveTuiControlQueueFor(workspaceRoot)
  const request = queue.requests.shift()
  if (request) return Promise.resolve(request)
  return new Promise<TuiControlRequest>((resolve) => {
    queue.requestWaiters.push(resolve)
  })
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

function providerAuthMethodsFor(
  providers: unknown,
): Record<string, ProviderAuthMethod[]> {
  if (!Array.isArray(providers)) return {}
  return Object.fromEntries(
    providers
      .map((provider) => providerAuthMethodEntry(provider))
      .filter(
        (entry): entry is [string, ProviderAuthMethod[]] => entry !== undefined,
      ),
  )
}

function providerAuthMethodEntry(
  provider: unknown,
): [string, ProviderAuthMethod[]] | undefined {
  if (!isRecord(provider)) return undefined
  const id = optionalString(provider.id)
  if (!id) return undefined
  const methods: ProviderAuthMethod[] = [
    {
      type: 'api',
      label: 'API key',
      prompts: [
        {
          type: 'text',
          key: 'key',
          message: `${id} API key`,
          placeholder: 'API key',
        },
      ],
    },
  ]
  methods.push({ type: 'oauth', label: 'OAuth' })
  return [id, methods]
}

function createProviderOauthUrl(
  providerId: string,
  method: number,
  inputs: Record<string, string> | undefined,
) {
  const url = new URL(
    `specter-code://provider/${encodeURIComponent(providerId)}/oauth`,
  )
  url.searchParams.set('method', String(method))
  for (const [key, value] of Object.entries(inputs ?? {})) {
    url.searchParams.set(key, value)
  }
  return url.toString()
}

function createMcpOauthUrl(name: string) {
  return `specter-code://mcp/${encodeURIComponent(name)}/oauth`
}

async function loadConfigForRegistry(workspaceRoot?: string) {
  return loadSpecterCodeConfig({
    workspaceRoot: workspaceRoot ?? process.cwd(),
  })
}

function createSessionShareUrl(sessionId: string) {
  const configuredBase = process.env.SPECTER_CODE_SHARE_BASE_URL
  const base =
    configuredBase && configuredBase.trim().length > 0
      ? configuredBase
      : 'specter-code://share'
  return `${base.replace(/\/$/, '')}/${encodeURIComponent(sessionId)}`
}

async function updateWorkspaceConfig(input: {
  workspaceRoot: string
  patch: JsonRecord
}) {
  const current = await loadSpecterCodeConfig({
    workspaceRoot: input.workspaceRoot,
  })
  const nextRaw = mergeConfigPatch(current.raw, input.patch)
  await writeWorkspaceConfig(input.workspaceRoot, nextRaw)
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

function experimentalCompatibilityRuntime(runtime: SpecterCodeApiRuntime) {
  return {
    listExperimentalConsole: (
      runtime.listExperimentalConsole ?? listExperimentalConsole
    ).bind(runtime),
    listExperimentalConsoleOrgs: (
      runtime.listExperimentalConsoleOrgs ?? listExperimentalConsoleOrgs
    ).bind(runtime),
    switchExperimentalConsoleOrg: (
      runtime.switchExperimentalConsoleOrg ?? switchExperimentalConsoleOrg
    ).bind(runtime),
    listExperimentalResources: (
      runtime.listExperimentalResources ?? listExperimentalResources
    ).bind(runtime),
    listExperimentalWorktrees: (
      runtime.listExperimentalWorktrees ?? listExperimentalWorktrees
    ).bind(runtime),
    createExperimentalWorktree: (
      runtime.createExperimentalWorktree ?? createExperimentalWorktree
    ).bind(runtime),
    removeExperimentalWorktree: (
      runtime.removeExperimentalWorktree ?? removeExperimentalWorktree
    ).bind(runtime),
    resetExperimentalWorktree: (
      runtime.resetExperimentalWorktree ?? resetExperimentalWorktree
    ).bind(runtime),
  }
}

function experimentalWorkspaceRuntime(runtime: SpecterCodeApiRuntime) {
  if (
    !runtime.listExperimentalWorkspaceAdapters ||
    !runtime.listExperimentalWorkspaces ||
    !runtime.createExperimentalWorkspace ||
    !runtime.deleteExperimentalWorkspace ||
    !runtime.syncExperimentalWorkspaceList ||
    !runtime.getExperimentalWorkspaceStatus ||
    !runtime.warpExperimentalWorkspace
  ) {
    throw new Error('Experimental workspace runtime is unavailable')
  }
  return {
    listExperimentalWorkspaceAdapters:
      runtime.listExperimentalWorkspaceAdapters.bind(runtime),
    listExperimentalWorkspaces:
      runtime.listExperimentalWorkspaces.bind(runtime),
    createExperimentalWorkspace:
      runtime.createExperimentalWorkspace.bind(runtime),
    deleteExperimentalWorkspace:
      runtime.deleteExperimentalWorkspace.bind(runtime),
    syncExperimentalWorkspaceList:
      runtime.syncExperimentalWorkspaceList.bind(runtime),
    getExperimentalWorkspaceStatus:
      runtime.getExperimentalWorkspaceStatus.bind(runtime),
    warpExperimentalWorkspace: runtime.warpExperimentalWorkspace.bind(runtime),
  }
}

async function listExperimentalConsole(input: {
  workspaceRoot: string
}): Promise<ExperimentalConsoleState> {
  const providers = await createProviderRegistry({
    config: await loadConfigForRegistry(input.workspaceRoot),
  }).listProviders()
  const active = liveExperimentalConsoleActiveOrg.get(
    experimentalWorkspaceKey(input.workspaceRoot),
  )
  return {
    consoleManagedProviders: providers.map((provider) => provider.id),
    activeOrgName: active ? active.orgId : undefined,
    switchableOrgCount: active ? 1 : 0,
  }
}

async function listExperimentalConsoleOrgs(input: {
  workspaceRoot: string
}): Promise<{ orgs: ExperimentalConsoleOrg[] }> {
  const active = liveExperimentalConsoleActiveOrg.get(
    experimentalWorkspaceKey(input.workspaceRoot),
  )
  if (!active) return { orgs: [] }
  return {
    orgs: [
      {
        accountID: active.accountId,
        accountEmail: `${active.accountId}@specter.local`,
        accountUrl: `specter-code://console/${encodeURIComponent(active.accountId)}`,
        orgID: active.orgId,
        orgName: active.orgId,
        active: true,
      },
    ],
  }
}

async function switchExperimentalConsoleOrg(input: {
  workspaceRoot: string
  accountId: string
  orgId: string
}): Promise<boolean> {
  liveExperimentalConsoleActiveOrg.set(
    experimentalWorkspaceKey(input.workspaceRoot),
    {
      accountId: input.accountId,
      orgId: input.orgId,
    },
  )
  return true
}

async function listExperimentalResources(_input: {
  workspaceRoot: string
}): Promise<Record<string, ExperimentalMcpResource>> {
  return {}
}

async function listExperimentalWorktrees(input: {
  workspaceRoot: string
}): Promise<string[]> {
  return (
    liveExperimentalWorktrees.get(
      experimentalWorkspaceKey(input.workspaceRoot),
    ) ?? []
  ).map((worktree) => worktree.directory)
}

async function createExperimentalWorktree(input: {
  workspaceRoot: string
  name?: string
  startCommand?: string
}): Promise<ExperimentalWorktree> {
  const key = experimentalWorkspaceKey(input.workspaceRoot)
  const name = sanitizeWorktreeName(input.name ?? `worktree-${Date.now()}`)
  const directory = path.join(
    input.workspaceRoot,
    '.specter-code-worktrees',
    name,
  )
  await mkdir(directory, { recursive: true })
  if (input.startCommand) {
    await writeFile(
      path.join(directory, '.specter-start-command'),
      `${input.startCommand}
`,
      'utf8',
    )
  }
  const worktree: ExperimentalWorktree = { name, branch: name, directory }
  const existing = liveExperimentalWorktrees.get(key) ?? []
  liveExperimentalWorktrees.set(key, [
    ...existing.filter((item) => item.directory !== directory),
    worktree,
  ])
  return worktree
}

async function removeExperimentalWorktree(input: {
  workspaceRoot: string
  directory: string
}): Promise<boolean> {
  const key = experimentalWorkspaceKey(input.workspaceRoot)
  const directory = containedWorktreeDirectory(
    input.workspaceRoot,
    input.directory,
  )
  const existing = liveExperimentalWorktrees.get(key) ?? []
  liveExperimentalWorktrees.set(
    key,
    existing.filter((item) => item.directory !== directory),
  )
  await rm(directory, { recursive: true, force: true })
  return existing.some((item) => item.directory === directory)
}

async function resetExperimentalWorktree(input: {
  workspaceRoot: string
  directory: string
}): Promise<boolean> {
  containedWorktreeDirectory(input.workspaceRoot, input.directory)
  return true
}

async function listExperimentalWorkspaceAdapters(input: {
  workspaceRoot: string
}): Promise<ExperimentalWorkspaceAdapter[]> {
  const gitReady = await hasGitDirectory(input.workspaceRoot)
  return [
    { id: 'local', name: 'Local workspace', primary: true },
    ...(gitReady ? [{ id: 'git-worktree', name: 'Git worktree' }] : []),
  ]
}

async function listExperimentalWorkspaces(input: {
  workspaceRoot: string
}): Promise<ExperimentalWorkspaceSummary[]> {
  const key = experimentalWorkspaceKey(input.workspaceRoot)
  const existing = liveExperimentalWorkspaces.get(key)
  if (existing) return existing
  const projects = await listWorkspaceProjects({
    workspaceRoot: input.workspaceRoot,
  })
  const workspaces = projects.map(projectToExperimentalWorkspace)
  liveExperimentalWorkspaces.set(key, workspaces)
  return workspaces
}

async function createExperimentalWorkspace(input: {
  workspaceRoot: string
  workspaceId?: string
  type?: string
  branch?: string
  metadata?: JsonRecord
}): Promise<ExperimentalWorkspaceSummary> {
  const key = experimentalWorkspaceKey(input.workspaceRoot)
  const workspaces = [...(await listExperimentalWorkspaces(input))]
  const workspace: ExperimentalWorkspaceSummary = {
    id: input.workspaceId ?? nextExperimentalWorkspaceId(input.workspaceRoot),
    type: input.type ?? 'local',
    name:
      input.branch ??
      (path.basename(input.workspaceRoot) || input.workspaceRoot),
    directory: input.workspaceRoot,
  }
  if (input.branch) workspace.branch = input.branch
  if (input.metadata) workspace.metadata = input.metadata
  liveExperimentalWorkspaces.set(key, [
    ...workspaces.filter((item) => item.id !== workspace.id),
    workspace,
  ])
  liveExperimentalWorkspaceActive.set(key, workspace.id)
  return workspace
}

async function deleteExperimentalWorkspace(input: {
  workspaceRoot: string
  workspaceId: string
}): Promise<boolean> {
  const key = experimentalWorkspaceKey(input.workspaceRoot)
  const workspaces = await listExperimentalWorkspaces(input)
  const next = workspaces.filter(
    (workspace) => workspace.id !== input.workspaceId,
  )
  liveExperimentalWorkspaces.set(key, next)
  if (liveExperimentalWorkspaceActive.get(key) === input.workspaceId) {
    liveExperimentalWorkspaceActive.delete(key)
  }
  return next.length !== workspaces.length
}

async function syncExperimentalWorkspaceList(input: { workspaceRoot: string }) {
  const key = experimentalWorkspaceKey(input.workspaceRoot)
  const projects = await listWorkspaceProjects({
    workspaceRoot: input.workspaceRoot,
  })
  const existing = liveExperimentalWorkspaces.get(key) ?? []
  const projectWorkspaces = projects.map(projectToExperimentalWorkspace)
  liveExperimentalWorkspaces.set(key, [
    ...projectWorkspaces,
    ...existing.filter(
      (workspace) =>
        !projectWorkspaces.some((project) => project.id === workspace.id),
    ),
  ])
}

async function getExperimentalWorkspaceStatus(input: {
  workspaceRoot: string
  workspaceId: string
}): Promise<ExperimentalWorkspaceStatus> {
  const workspace = (await listExperimentalWorkspaces(input)).find(
    (item) => item.id === input.workspaceId,
  )
  if (!workspace) return { id: input.workspaceId, status: 'missing' }
  return {
    id: workspace.id,
    status: 'ready',
    directory: workspace.directory,
    branch: workspace.branch,
  }
}

async function warpExperimentalWorkspace(input: {
  workspaceRoot: string
  workspaceId: string
}) {
  const key = experimentalWorkspaceKey(input.workspaceRoot)
  const status = await getExperimentalWorkspaceStatus(input)
  if (status.status === 'missing')
    throw new Error(`Workspace not found: ${input.workspaceId}`)
  liveExperimentalWorkspaceActive.set(key, input.workspaceId)
}

function projectToExperimentalWorkspace(
  project: ProjectSummary,
): ExperimentalWorkspaceSummary {
  const workspace: ExperimentalWorkspaceSummary = {
    id:
      project.id === project.directory
        ? nextExperimentalWorkspaceId(project.directory)
        : project.id,
    type: project.vcs === 'git' ? 'git-worktree' : 'local',
    name: project.name,
    directory: project.directory,
  }
  if (project.worktree) workspace.branch = path.basename(project.worktree)
  return workspace
}

function experimentalWorkspaceKey(workspaceRoot: string) {
  return path.resolve(workspaceRoot)
}

function nextExperimentalWorkspaceId(workspaceRoot: string) {
  const name = path.basename(workspaceRoot) || 'workspace'
  return `wrk_${name.replace(/[^a-zA-Z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '') || 'workspace'}`
}

function experimentalWorkspaceIdFromQuery(url: URL) {
  return (
    optionalQuery(url, 'id') ??
    optionalQuery(url, 'workspaceID') ??
    optionalQuery(url, 'workspaceId') ??
    optionalQuery(url, 'workspace') ??
    nextExperimentalWorkspaceId(workspaceRootFromFindQuery(url))
  )
}

function sanitizeWorktreeName(name: string) {
  return (
    name.replace(/[^a-zA-Z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '') || 'worktree'
  )
}

function containedWorktreeDirectory(workspaceRoot: string, candidate: string) {
  const root = path.resolve(workspaceRoot, '.specter-code-worktrees')
  const resolved = path.resolve(candidate)
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error('Worktree directory must be under .specter-code-worktrees')
  }
  return resolved
}

async function updateWorkspaceProject(input: {
  workspaceRoot: string
  projectId: string
  name?: string
  icon?: string
  commands?: JsonRecord
}): Promise<ProjectSummary> {
  if (
    input.projectId !== input.workspaceRoot &&
    input.projectId !== path.basename(input.workspaceRoot)
  ) {
    throw new Error(`Project not found: ${input.projectId}`)
  }
  const current = await loadSpecterCodeConfig({
    workspaceRoot: input.workspaceRoot,
  })
  const currentProject = isRecord(current.raw.project)
    ? current.raw.project
    : {}
  const nextProject: JsonRecord = { ...currentProject }
  if (input.name !== undefined) nextProject.name = input.name
  if (input.icon !== undefined) nextProject.icon = input.icon
  if (input.commands !== undefined) nextProject.commands = input.commands

  await writeWorkspaceConfig(input.workspaceRoot, {
    ...current.raw,
    project: nextProject,
  })
  return firstProject(
    await listWorkspaceProjects({ workspaceRoot: input.workspaceRoot }),
  )
}

async function initializeWorkspaceGitProject(input: {
  workspaceRoot: string
}): Promise<ProjectSummary> {
  await initGitRepository({ workspaceRoot: input.workspaceRoot })
  return firstProject(
    await listWorkspaceProjects({ workspaceRoot: input.workspaceRoot }),
  )
}

async function listWorkspaceProjects(input: {
  workspaceRoot: string
}): Promise<ProjectSummary[]> {
  const config = await loadSpecterCodeConfig({
    workspaceRoot: input.workspaceRoot,
  })
  const projectConfig = isRecord(config.raw.project) ? config.raw.project : {}
  const gitReady = await hasGitDirectory(input.workspaceRoot)
  const summary: ProjectSummary = {
    id: input.workspaceRoot,
    directory: input.workspaceRoot,
    name:
      optionalString(projectConfig.name) ??
      (path.basename(input.workspaceRoot) || input.workspaceRoot),
    configSources: config.sources,
  }
  const icon = optionalString(projectConfig.icon)
  if (icon) summary.icon = icon
  const commands = optionalJsonRecord(projectConfig.commands)
  if (commands) summary.commands = commands
  if (gitReady) {
    summary.vcs = 'git'
    summary.worktree = input.workspaceRoot
  }
  return [summary]
}

async function hasGitDirectory(workspaceRoot: string) {
  try {
    const stat = await lstat(path.join(workspaceRoot, '.git'))
    return stat.isDirectory()
  } catch {
    return false
  }
}

async function writeWorkspaceConfig(workspaceRoot: string, raw: JsonRecord) {
  const configDir = path.join(workspaceRoot, '.opencode')
  await mkdir(configDir, { recursive: true })
  await writeFile(
    path.join(configDir, 'opencode.jsonc'),
    `${JSON.stringify(raw, null, 2)}\n`,
    'utf8',
  )
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
    return [
      {
        name: fallbackName,
        command: value,
        enabled: true,
        status: 'configured',
      },
    ]
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

function readLogLevel(value: unknown): OpenCodeLogLevel {
  if (
    value === 'debug' ||
    value === 'info' ||
    value === 'warn' ||
    value === 'error'
  ) {
    return value
  }
  throw new Error('Invalid log level')
}

function readSyncHistoryCursor(body: JsonRecord): Record<string, number> {
  const cursor: Record<string, number> = {}
  for (const [aggregateId, seq] of Object.entries(body)) {
    if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0) {
      throw new Error('Invalid sync history cursor')
    }
    cursor[aggregateId] = seq
  }
  return cursor
}

function readReplaySyncEvents(value: unknown): OpenCodeReplaySyncEvent[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('Missing required field: events')
  }
  return value.map((event) => {
    if (!isRecord(event)) throw new Error('Invalid sync event')
    return {
      id: requiredString(event.id, 'event.id'),
      aggregateID: requiredString(event.aggregateID, 'event.aggregateID'),
      seq: readNonNegativeInteger(event.seq, 'event.seq'),
      type: requiredString(event.type, 'event.type'),
      data: requiredRecord(event.data, 'event.data'),
    }
  })
}

function readNonNegativeInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid ${name}`)
  }
  return value
}

function smallestSyncCursor(input: Record<string, number>) {
  const values = Object.values(input)
  if (values.length === 0) return undefined
  return Math.min(...values)
}

function toOpenCodeSyncEvent(event: SpecterCodeStreamEvent): OpenCodeSyncEvent {
  return {
    id: event.id,
    aggregate_id: readSyncAggregateId(event),
    seq: event.order,
    type: event.type,
    data: isRecord(event.payload) ? event.payload : {},
  }
}

function readSyncAggregateId(event: SpecterCodeStreamEvent) {
  const payload = isRecord(event.payload) ? event.payload : {}
  return (
    optionalString(payload.sessionId) ??
    optionalString(payload.workspaceId) ??
    optionalString(payload.runId) ??
    event.id
  )
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

function requiredNumber(value: unknown, name: string) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Missing required field: ${name}`)
  }
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

function optionalJsonRecord(value: unknown): JsonRecord | undefined {
  return isRecord(value) ? value : undefined
}

function optionalStringRecord(
  value: unknown,
): Record<string, string> | undefined {
  if (value === undefined || value === null) return undefined
  if (!isRecord(value)) throw new Error('Invalid string record')
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      requiredString(item, key),
    ]),
  )
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

function readOpenCodeBodyModel(value: unknown) {
  if (!isRecord(value)) throw new Error('Missing request body')
  return {
    providerId:
      optionalString(value.providerId) ??
      requiredString(value.providerID, 'providerID'),
    modelId:
      optionalString(value.modelId) ?? requiredString(value.modelID, 'modelID'),
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
      optionalString(value.modelId) ??
      requiredString(value.modelID, 'model.modelID'),
  }
}

function readMessagePartPatchText(body: JsonRecord) {
  const directText = optionalString(body.text) ?? optionalString(body.content)
  if (directText !== undefined) return directText
  const part = isRecord(body.part) ? body.part : undefined
  const partText = part ? optionalString(part.text) : undefined
  if (partText !== undefined) return partText
  throw new Error('Missing required field: text')
}

function toOpenCodeMessageDetail(message: unknown) {
  if (!isRecord(message)) throw new Error('Session message is unavailable')
  const id = requiredString(message.id, 'message.id')
  const sessionId = requiredString(message.sessionId, 'message.sessionId')
  const role = requiredString(message.role, 'message.role')
  const content = typeof message.content === 'string' ? message.content : ''
  return {
    info: {
      id,
      sessionID: sessionId,
      role,
    },
    parts: content
      ? [
          {
            id: 'part_text',
            type: 'text',
            text: content,
          },
        ]
      : [],
  }
}

function readMessagePartsText(value: unknown) {
  if (!Array.isArray(value)) throw new Error('Missing required field: parts')
  const chunks = value.map((part) => {
    if (!isRecord(part)) throw new Error('Invalid message part')
    if (part.type !== 'text')
      throw new Error('Only text message parts are supported')
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

function readOpenCodePermissionResponse(value: unknown) {
  if (value === 'once' || value === 'always' || value === 'reject') return value
  throw new Error('Missing required field: response')
}

function jsonResponse(value: unknown, status = 200) {
  return Response.json(value, { status })
}

function noContentResponse() {
  return new Response(null, { status: 204 })
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

function providerById(value: unknown, providerId: string) {
  if (!Array.isArray(value)) return value
  const provider = value.find(
    (item) => isRecord(item) && item.id === providerId,
  )
  if (!provider) throw new Error('Unknown provider: ' + providerId)
  return provider
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

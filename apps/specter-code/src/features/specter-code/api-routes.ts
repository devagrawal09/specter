import { createAgentRegistry, type AgentSummary } from './adapters/agent-registry'
import { loadSpecterCodeConfig, type SpecterCodeConfig } from './adapters/config-loader'
import { createSpecterCodeEventStream, type SpecterCodeStreamEvent } from './adapters/event-stream'
import { createProviderRegistry, type ProviderSummary } from './adapters/llm-provider'
import type { RouteSpec } from './domain/openapi-compat'

export type JsonRecord = Record<string, unknown>

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
  listEvents(input: { afterOrder?: number }): Promise<readonly SpecterCodeStreamEvent[]>
}

export const INITIAL_OPENCODE_API_ROUTES = [
  { method: 'GET', normalizedPath: '/agent' },
  { method: 'GET', normalizedPath: '/config' },
  { method: 'GET', normalizedPath: '/event' },
  { method: 'GET', normalizedPath: '/file' },
  { method: 'GET', normalizedPath: '/file/content' },
  { method: 'GET', normalizedPath: '/file/status' },
  { method: 'GET', normalizedPath: '/permission' },
  { method: 'POST', normalizedPath: '/permission/:requestID/reply' },
  { method: 'GET', normalizedPath: '/provider' },
  { method: 'GET', normalizedPath: '/session' },
  { method: 'POST', normalizedPath: '/session' },
  { method: 'GET', normalizedPath: '/session/:sessionID/message' },
  { method: 'POST', normalizedPath: '/session/:sessionID/prompt_async' },
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

  if (method === 'GET' && pathname === '/provider') {
    return jsonResponse(
      await runtime.listProviders({ workspaceRoot: optionalQuery(url, 'workspaceRoot') }),
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
    async listEvents(input) {
      const runtime = await import('./server-runtime.server')
      return runtime.listSpecterCodeEventsOnServer(input)
    },
  }
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

function workspaceRootFromQuery(url: URL) {
  return optionalQuery(url, 'workspaceRoot') ?? process.cwd()
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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

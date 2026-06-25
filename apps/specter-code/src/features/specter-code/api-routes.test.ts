import { describe, expect, it } from 'vitest'

import {
  createOpenCodeCompatibilityReport,
  type RouteSpec,
} from './domain/openapi-compat'
import {
  createSpecterCodeApiRouter,
  INITIAL_OPENCODE_API_ROUTES,
  implementedOpenCodeApiRoutes,
  type SpecterCodeApiRuntime,
} from './api-routes'

function createRuntime(): SpecterCodeApiRuntime & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    async listSessions(input) {
      calls.push(`listSessions:${input.workspaceId}`)
      return [{ id: 'session-main', title: 'Main session' }]
    },
    async createSession(input) {
      calls.push(`createSession:${input.sessionId}:${input.workspaceId}:${input.title}`)
      return { id: input.sessionId ?? 'generated-session', title: input.title }
    },
    async submitPrompt(input) {
      calls.push(`submitPrompt:${input.sessionId}:${input.workspaceId}:${input.content}`)
      return { runId: input.runId ?? 'generated-run', messageId: input.messageId ?? 'generated-message' }
    },
    async listSessionTranscript(input) {
      calls.push(`transcript:${input.sessionId}`)
      return [{ id: 'message-1', role: 'assistant', content: 'done' }]
    },
    async listFileTree(input) {
      calls.push(`fileTree:${input.workspaceId}:${input.parentPath ?? ''}`)
      return [{ path: 'src/index.ts', type: 'file' }]
    },
    async readFileContent(input) {
      calls.push(`readFile:${input.workspaceId}:${input.path}`)
      return 'export const value = 1\n'
    },
    async getFileStatus(input) {
      calls.push(`fileStatus:${input.workspaceId}`)
      return { initialized: true, latestScan: null }
    },
    async listPendingPermissions(input) {
      calls.push(`permissions:${input.sessionId}`)
      return [{ requestId: 'request-1', action: 'ask' }]
    },
    async replyPermission(input) {
      calls.push(`replyPermission:${input.requestId}:${input.sessionId}:${input.action}`)
      return { requestId: input.requestId, action: input.action }
    },
    async loadConfig(input) {
      calls.push(`config:${input.workspaceRoot}`)
      return { sources: [], permissionRules: [], raw: { model: 'openrouter/test' } }
    },
    async listProviders() {
      calls.push('providers')
      return [{ id: 'openrouter', configured: false, models: [] }]
    },
    async listAgents() {
      calls.push('agents')
      return [{ id: 'build', default: true, tools: ['read'] }]
    },
    async listEvents(input) {
      calls.push(`events:${input.afterOrder ?? 0}`)
      return [
        {
          id: 'event-2',
          order: 2,
          type: 'agentRunCompleted',
          payload: { runId: 'run-1' },
          recordedAt: '2026-06-24T12:00:02.000Z',
        },
      ]
    },
    async findFiles(input) {
      calls.push(`findFiles:${input.workspaceRoot}:${input.query}:${input.limit ?? ''}`)
      return ['src/index.ts']
    },
    async findText(input) {
      calls.push(`findText:${input.workspaceRoot}:${input.pattern}`)
      return [
        {
          path: { text: 'src/index.ts' },
          lines: { text: 'export const value = 1' },
          line_number: 1,
          absolute_offset: 0,
          submatches: [{ match: { text: 'value' }, start: 13, end: 18 }],
        },
      ]
    },
    async getVcsStatus(input) {
      calls.push(`vcsStatus:${input.workspaceRoot}`)
      return { branch: 'threadplane-work', clean: false, entries: [{ path: 'src/index.ts', index: ' ', workingTree: 'M' }] }
    },
    async getVcsDiff(input) {
      calls.push(`vcsDiff:${input.workspaceRoot}:${input.path ?? ''}:${input.staged ? 'staged' : 'unstaged'}`)
      return { patch: 'diff --git a/src/index.ts b/src/index.ts\n', staged: input.staged ?? false, path: input.path }
    },
    async applyVcsPatch(input) {
      calls.push(`vcsApply:${input.workspaceRoot}:${input.staged ? 'staged' : 'unstaged'}`)
      return { paths: ['src/index.ts'], staged: input.staged ?? false }
    },
  }
}

async function json(response: Response) {
  return (await response.json()) as unknown
}

describe('Specter Code OpenCode API route adapter', () => {
  it('declares the currently implemented OpenCode-compatible HTTP routes', () => {
    const report = createOpenCodeCompatibilityReport({
      openCodeRoutes: INITIAL_OPENCODE_API_ROUTES,
      implementedRoutes: implementedOpenCodeApiRoutes,
      requiredRoutes: INITIAL_OPENCODE_API_ROUTES,
    })

    expect(report.summary).toEqual({
      required: INITIAL_OPENCODE_API_ROUTES.length,
      matched: INITIAL_OPENCODE_API_ROUTES.length,
      missing: 0,
    })
    expect(implementedOpenCodeApiRoutes).toEqual<RouteSpec[]>([
      { method: 'GET', normalizedPath: '/agent' },
      { method: 'GET', normalizedPath: '/config' },
      { method: 'GET', normalizedPath: '/event' },
      { method: 'GET', normalizedPath: '/find' },
      { method: 'GET', normalizedPath: '/find/file' },
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
      { method: 'GET', normalizedPath: '/vcs' },
      { method: 'POST', normalizedPath: '/vcs/apply' },
      { method: 'GET', normalizedPath: '/vcs/diff' },
      { method: 'GET', normalizedPath: '/vcs/status' },
    ])
  })

  it('dispatches session, file, permission, config, provider, agent, and event requests to runtime handlers', async () => {
    const runtime = createRuntime()
    const router = createSpecterCodeApiRouter({ runtime })

    await expect(
      json(await router.handle(new Request('http://specter.test/session?workspaceId=workspace-main'))),
    ).resolves.toEqual([{ id: 'session-main', title: 'Main session' }])

    await expect(
      json(
        await router.handle(
          new Request('http://specter.test/session', {
            method: 'POST',
            body: JSON.stringify({
              sessionId: 'session-main',
              workspaceId: 'workspace-main',
              title: 'Implement API routes',
              directory: '/repo',
              agent: 'build',
              model: { providerId: 'openrouter', modelId: 'anthropic/claude-sonnet-4' },
            }),
          }),
        ),
      ),
    ).resolves.toEqual({ id: 'session-main', title: 'Implement API routes' })

    await expect(
      json(await router.handle(new Request('http://specter.test/session/session-main/message'))),
    ).resolves.toEqual([{ id: 'message-1', role: 'assistant', content: 'done' }])

    await expect(
      json(
        await router.handle(
          new Request('http://specter.test/session/session-main/prompt_async', {
            method: 'POST',
            body: JSON.stringify({ workspaceId: 'workspace-main', content: 'ship it', agentId: 'build' }),
          }),
        ),
      ),
    ).resolves.toEqual({ runId: 'generated-run', messageId: 'generated-message' })

    await expect(
      json(await router.handle(new Request('http://specter.test/file?workspaceId=workspace-main&path=src'))),
    ).resolves.toEqual([{ path: 'src/index.ts', type: 'file' }])

    await expect(
      json(await router.handle(new Request('http://specter.test/file/content?workspaceId=workspace-main&path=src/index.ts'))),
    ).resolves.toEqual({ content: 'export const value = 1\n' })

    await expect(
      json(await router.handle(new Request('http://specter.test/file/status?workspaceId=workspace-main'))),
    ).resolves.toEqual({ initialized: true, latestScan: null })

    await expect(
      json(await router.handle(new Request('http://specter.test/permission?sessionId=session-main'))),
    ).resolves.toEqual([{ requestId: 'request-1', action: 'ask' }])

    await expect(
      json(
        await router.handle(
          new Request('http://specter.test/permission/request-1/reply', {
            method: 'POST',
            body: JSON.stringify({ sessionId: 'session-main', action: 'allow' }),
          }),
        ),
      ),
    ).resolves.toEqual({ requestId: 'request-1', action: 'allow' })

    await expect(
      json(await router.handle(new Request('http://specter.test/config?workspaceRoot=/repo'))),
    ).resolves.toEqual({ sources: [], permissionRules: [], raw: { model: 'openrouter/test' } })
    await expect(json(await router.handle(new Request('http://specter.test/provider')))).resolves.toEqual([
      { id: 'openrouter', configured: false, models: [] },
    ])
    await expect(json(await router.handle(new Request('http://specter.test/agent')))).resolves.toEqual([
      { id: 'build', default: true, tools: ['read'] },
    ])

    await expect(
      json(
        await router.handle(
          new Request('http://specter.test/find/file?directory=/repo&query=index&limit=25'),
        ),
      ),
    ).resolves.toEqual(['src/index.ts'])

    await expect(
      json(
        await router.handle(
          new Request('http://specter.test/find?directory=/repo&pattern=value&limit=10'),
        ),
      ),
    ).resolves.toEqual([
      {
        path: { text: 'src/index.ts' },
        lines: { text: 'export const value = 1' },
        line_number: 1,
        absolute_offset: 0,
        submatches: [{ match: { text: 'value' }, start: 13, end: 18 }],
      },
    ])

    await expect(
      json(await router.handle(new Request('http://specter.test/vcs?workspaceRoot=/repo'))),
    ).resolves.toEqual({
      branch: 'threadplane-work',
      clean: false,
      entries: [{ path: 'src/index.ts', index: ' ', workingTree: 'M' }],
    })

    await expect(
      json(await router.handle(new Request('http://specter.test/vcs/status?workspaceRoot=/repo'))),
    ).resolves.toEqual({
      branch: 'threadplane-work',
      clean: false,
      entries: [{ path: 'src/index.ts', index: ' ', workingTree: 'M' }],
    })

    await expect(
      json(
        await router.handle(
          new Request('http://specter.test/vcs/diff?workspaceRoot=/repo&path=src/index.ts&staged=true'),
        ),
      ),
    ).resolves.toEqual({
      patch: 'diff --git a/src/index.ts b/src/index.ts\n',
      staged: true,
      path: 'src/index.ts',
    })

    await expect(
      json(
        await router.handle(
          new Request('http://specter.test/vcs/apply', {
            method: 'POST',
            body: JSON.stringify({ workspaceRoot: '/repo', patch: 'diff --git a/src/index.ts b/src/index.ts\n', staged: false }),
          }),
        ),
      ),
    ).resolves.toEqual({ paths: ['src/index.ts'], staged: false })

    const eventResponse = await router.handle(new Request('http://specter.test/event?after=1&live=false'))
    expect(eventResponse.headers.get('content-type')).toBe('text/event-stream; charset=utf-8')
    await expect(eventResponse.text()).resolves.toBe(
      'id: 2\n' +
        'event: agentRunCompleted\n' +
        'data: {"id":"event-2","order":2,"type":"agentRunCompleted","payload":{"runId":"run-1"},"recordedAt":"2026-06-24T12:00:02.000Z"}\n\n',
    )

    expect(runtime.calls).toEqual([
      'listSessions:workspace-main',
      'createSession:session-main:workspace-main:Implement API routes',
      'transcript:session-main',
      'submitPrompt:session-main:workspace-main:ship it',
      'fileTree:workspace-main:src',
      'readFile:workspace-main:src/index.ts',
      'fileStatus:workspace-main',
      'permissions:session-main',
      'replyPermission:request-1:session-main:allow',
      'config:/repo',
      'providers',
      'agents',
      'findFiles:/repo:index:25',
      'findText:/repo:value',
      'vcsStatus:/repo',
      'vcsStatus:/repo',
      'vcsDiff:/repo:src/index.ts:staged',
      'vcsApply:/repo:unstaged',
      'events:1',
    ])
  })

  it('returns JSON errors for unmatched routes, invalid bodies, and missing query parameters', async () => {
    const router = createSpecterCodeApiRouter({ runtime: createRuntime() })

    const missingParam = await router.handle(new Request('http://specter.test/session'))
    expect(missingParam.status).toBe(400)
    await expect(json(missingParam)).resolves.toEqual({ error: 'Missing required query parameter: workspaceId' })

    const invalidJson = await router.handle(
      new Request('http://specter.test/session', { method: 'POST', body: '{' }),
    )
    expect(invalidJson.status).toBe(400)
    await expect(json(invalidJson)).resolves.toEqual({ error: 'Invalid JSON request body' })

    const notFound = await router.handle(new Request('http://specter.test/session/session-main', { method: 'DELETE' }))
    expect(notFound.status).toBe(404)
    await expect(json(notFound)).resolves.toEqual({ error: 'No OpenCode-compatible route for DELETE /session/session-main' })
  })
})

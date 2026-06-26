import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

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
      calls.push(
        `createSession:${input.sessionId}:${input.workspaceId}:${input.title}`,
      )
      return { id: input.sessionId ?? 'generated-session', title: input.title }
    },
    async getSession(input) {
      calls.push(`getSession:${input.sessionId}`)
      return {
        id: input.sessionId,
        title: 'Main session',
        workspaceId: 'workspace-main',
      }
    },
    async updateSession(input) {
      calls.push(`updateSession:${input.sessionId}:${input.title ?? ''}`)
      return {
        id: input.sessionId,
        title: input.title ?? 'Main session',
        workspaceId: 'workspace-main',
      }
    },
    async deleteSession(input) {
      calls.push(`deleteSession:${input.sessionId}`)
      return true
    },
    async submitPrompt(input) {
      calls.push(
        `submitPrompt:${input.sessionId}:${input.workspaceId}:${input.content}`,
      )
      return {
        runId: input.runId ?? 'generated-run',
        messageId: input.messageId ?? 'generated-message',
      }
    },
    async listSessionTranscript(input) {
      calls.push(`transcript:${input.sessionId}`)
      return [{ id: 'message-1', role: 'assistant', content: 'done' }]
    },
    async listSessionContext(input) {
      calls.push(`context:${input.sessionId}`)
      return [{ id: 'message-1', role: 'user', content: 'active prompt' }]
    },
    async listSessionStatus(input) {
      calls.push(`sessionStatus:${input.workspaceRoot ?? ''}`)
      return { 'session-main': { status: 'idle', sessionId: 'session-main' } }
    },
    async createSessionMessage(input) {
      calls.push(
        `sessionMessage:${input.sessionId}:${input.messageId ?? ''}:${input.agentId}:${input.noReply ? 'no-reply' : 'reply'}:${input.content}`,
      )
      return {
        info: {
          id: input.messageId ?? 'generated-message',
          sessionID: input.sessionId,
          role: 'assistant',
        },
        parts: [],
      }
    },
    async abortSession(input) {
      calls.push(`abortSession:${input.sessionId}`)
      return true
    },
    async getSessionMessage(input) {
      calls.push(`messageGet:${input.sessionId}:${input.messageId}`)
      return {
        info: { id: input.messageId, sessionID: input.sessionId, role: 'user' },
        parts: [{ id: 'part_text', type: 'text', text: 'hello' }],
      }
    },
    async updateSessionMessagePart(input) {
      calls.push(
        `partPatch:${input.sessionId}:${input.messageId}:${input.partId}:${input.text}`,
      )
      return {
        info: { id: input.messageId, sessionID: input.sessionId, role: 'user' },
        parts: [{ id: input.partId, type: 'text', text: input.text }],
      }
    },
    async deleteSessionMessagePart(input) {
      calls.push(
        `partDelete:${input.sessionId}:${input.messageId}:${input.partId}`,
      )
      return {
        info: { id: input.messageId, sessionID: input.sessionId, role: 'user' },
        parts: [],
      }
    },
    async deleteSessionMessage(input) {
      calls.push(`messageDelete:${input.sessionId}:${input.messageId}`)
      return true
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
    async listSessionTodos(input) {
      calls.push(`sessionTodos:${input.sessionId}`)
      return [
        { id: 'todo-1', content: 'Ship API route', status: 'in_progress' },
      ]
    },
    async listSessionChildren(input) {
      calls.push(`sessionChildren:${input.sessionId}`)
      return [
        {
          id: 'session-child',
          parentSessionId: input.sessionId,
          title: 'Child session',
        },
      ]
    },
    async forkSession(input) {
      calls.push(
        `forkSession:${input.sessionId}:${input.newSessionId ?? ''}:${input.title ?? ''}`,
      )
      return {
        id: input.newSessionId ?? 'session-child',
        parentSessionId: input.sessionId,
        title: input.title ?? 'Fork of Main session',
      }
    },
    async listPendingPermissions(input) {
      calls.push(`permissions:${input.sessionId}`)
      return [{ requestId: 'request-1', action: 'ask' }]
    },
    async replyPermission(input) {
      calls.push(
        `replyPermission:${input.requestId}:${input.sessionId}:${input.action}`,
      )
      return { requestId: input.requestId, action: input.action }
    },
    async loadConfig(input) {
      calls.push(`config:${input.workspaceRoot}`)
      return {
        sources: [],
        permissionRules: [],
        raw: { model: 'openrouter/test' },
      }
    },
    async updateConfig(input) {
      calls.push(`configPatch:${input.workspaceRoot}:${JSON.stringify(input.patch)}`)
      return {
        sources: [`${input.workspaceRoot}/.opencode/opencode.jsonc`],
        permissionRules: [],
        raw: input.patch,
      }
    },
    async listProjects(input) {
      calls.push(`projects:${input.workspaceRoot}`)
      return [
        {
          id: input.workspaceRoot,
          directory: input.workspaceRoot,
          name: 'repo',
          configSources: [`${input.workspaceRoot}/.opencode/opencode.jsonc`],
        },
      ]
    },
    async updateProject(input) {
      calls.push(`projectUpdate:${input.projectId}:${input.workspaceRoot}:${input.name ?? ''}`)
      return {
        id: input.projectId,
        directory: input.workspaceRoot,
        name: input.name ?? 'repo',
        icon: input.icon,
        commands: input.commands,
        configSources: [`${input.workspaceRoot}/.opencode/opencode.jsonc`],
      }
    },
    async initializeProjectGit(input) {
      calls.push(`projectGitInit:${input.workspaceRoot}`)
      return {
        id: input.workspaceRoot,
        directory: input.workspaceRoot,
        name: 'repo',
        vcs: 'git',
        worktree: input.workspaceRoot,
        configSources: [`${input.workspaceRoot}/.opencode/opencode.jsonc`],
      }
    },
    async listFormatterStatus(input) {
      calls.push(`formatters:${input.workspaceRoot}`)
      return [
        {
          name: 'prettier',
          command: 'pnpm prettier --check .',
          enabled: true,
        },
      ]
    },
    async listProviders() {
      calls.push('providers')
      return [{ id: 'openrouter', configured: false, models: [] }]
    },
    async listAgents() {
      calls.push('agents')
      return [{ id: 'build', default: true, tools: ['read'] }]
    },
    async listToolIds(input) {
      calls.push(`toolIds:${input.workspaceRoot}`)
      return ['read']
    },
    async listTools(input) {
      calls.push(`tools:${input.workspaceRoot}:${input.providerId}/${input.modelId}`)
      return [
        {
          id: 'read',
          description: 'Read a file inside the current workspace',
          parameters: { type: 'object' },
        },
      ]
    },
    async listPendingQuestions(input) {
      calls.push(`questions:${input.sessionId ?? 'all'}`)
      return [
        {
          questionId: 'question-1',
          sessionId: 'session-main',
          messageId: 'message-1',
          prompt: 'Run tests?',
          options: [],
          allowFreeform: true,
        },
      ]
    },
    async replyQuestion(input) {
      const serializedAnswers = input.answers
        .map((answer) => answer.join(','))
        .join('|')
      calls.push(`replyQuestion:${input.requestId}:${serializedAnswers}`)
      return true
    },
    async rejectQuestion(input) {
      calls.push(`rejectQuestion:${input.requestId}:${input.reason ?? ''}`)
      return true
    },
    async listSkills(input) {
      calls.push(`skills:${input.workspaceRoot}`)
      return [
        {
          name: 'review',
          description: 'Review local code changes',
          location: '/repo/.opencode/skills/review/SKILL.md',
          content: '# Review\n',
        },
      ]
    },
    async listCommands(input) {
      calls.push(`commands:${input.workspaceRoot}`)
      return [
        {
          name: 'fix',
          description: 'Fix a file',
          source: 'command' as const,
          template: 'Fix $1: $ARGUMENTS',
          hints: ['$1', '$ARGUMENTS'],
        },
      ]
    },
    async executeSessionCommand(input) {
      calls.push(
        `sessionCommand:${input.sessionId}:${input.messageId ?? ''}:${input.workspaceRoot}:${input.command}:${input.arguments ?? ''}:${input.agentId ?? ''}:${input.model?.providerId ?? ''}/${input.model?.modelId ?? ''}`,
      )
      return {
        info: {
          id: input.messageId ?? 'generated-command-message',
          sessionID: input.sessionId,
          role: 'assistant',
        },
        parts: [],
      }
    },
    async initializeSession(input: {
      sessionId: string
      messageId: string
      workspaceRoot: string
      model: { providerId: string; modelId: string }
    }) {
      calls.push(
        `sessionInit:${input.sessionId}:${input.messageId}:${input.workspaceRoot}:${input.model.providerId}/${input.model.modelId}`,
      )
      return true
    },
    async summarizeSession(input: {
      sessionId: string
      workspaceRoot: string
      providerId: string
      modelId: string
      auto?: boolean
    }) {
      calls.push(
        `sessionSummarize:${input.sessionId}:${input.workspaceRoot}:${input.providerId}/${input.modelId}:${input.auto ? 'auto' : 'manual'}`,
      )
      return true
    },
    async compactSession(input: { sessionId: string; workspaceRoot: string }) {
      calls.push(`sessionCompact:${input.sessionId}:${input.workspaceRoot}`)
    },
    async waitForSession(input: { sessionId: string; workspaceRoot: string }) {
      calls.push(`sessionWait:${input.sessionId}:${input.workspaceRoot}`)
    },
    async runSessionShell(input: {
      sessionId: string
      messageId?: string
      workspaceRoot: string
      agentId: string
      command: string
      model?: { providerId: string; modelId: string }
    }) {
      calls.push(
        `sessionShell:${input.sessionId}:${input.messageId ?? ''}:${input.workspaceRoot}:${input.agentId}:${input.command}:${input.model?.providerId ?? ''}/${input.model?.modelId ?? ''}`,
      )
      return {
        info: {
          id: input.messageId ?? 'generated-shell-message',
          sessionID: input.sessionId,
          role: 'assistant',
        },
        parts: [],
      }
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
      calls.push(
        `findFiles:${input.workspaceRoot}:${input.query}:${input.limit ?? ''}`,
      )
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
    async findSymbols(input) {
      calls.push(
        `findSymbols:${input.workspaceRoot}:${input.query}:${input.limit ?? ''}`,
      )
      return [
        {
          path: 'src/index.ts',
          lineNumber: 1,
          name: 'makeValue',
          kind: 'function',
        },
      ]
    },
    async listLspDiagnostics(input) {
      calls.push(
        `lspDiagnostics:${input.workspaceRoot}:${input.include?.join(',') ?? ''}`,
      )
      return [
        {
          path: 'src/index.ts',
          lineNumber: 1,
          column: 14,
          category: 'error',
          code: 2322,
          message: "Type 'string' is not assignable to type 'number'",
        },
      ]
    },
    async listMcpStatus(input) {
      calls.push(`mcpStatus:${input.workspaceRoot}`)
      return {}
    },
    async addMcpServer(input) {
      calls.push(
        `mcpAdd:${input.workspaceRoot}:${input.name}:${JSON.stringify(input.config)}`,
      )
      return {
        [input.name]: { name: input.name, status: 'disconnected' as const },
      }
    },
    async connectMcpServer(input) {
      calls.push(`mcpConnect:${input.workspaceRoot}:${input.name}`)
      return true
    },
    async disconnectMcpServer(input) {
      calls.push(`mcpDisconnect:${input.workspaceRoot}:${input.name}`)
      return true
    },
    async getVcsStatus(input) {
      calls.push(`vcsStatus:${input.workspaceRoot}`)
      return {
        branch: 'threadplane-work',
        clean: false,
        entries: [{ path: 'src/index.ts', index: ' ', workingTree: 'M' }],
      }
    },
    async getVcsDiff(input) {
      calls.push(
        `vcsDiff:${input.workspaceRoot}:${input.path ?? ''}:${input.staged ? 'staged' : 'unstaged'}`,
      )
      return {
        patch: 'diff --git a/src/index.ts b/src/index.ts\n',
        staged: input.staged ?? false,
        path: input.path,
      }
    },
    async applyVcsPatch(input) {
      calls.push(
        `vcsApply:${input.workspaceRoot}:${input.staged ? 'staged' : 'unstaged'}`,
      )
      return { paths: ['src/index.ts'], staged: input.staged ?? false }
    },
    async revertSession(input) {
      calls.push(`sessionRevert:${input.sessionId}:${input.workspaceRoot}:${input.paths.join(',')}`)
      return { paths: input.paths }
    },
    async shareSession(input) {
      calls.push(`sessionShare:${input.sessionId}`)
      return {
        id: input.sessionId,
        title: 'Main session',
        share: { url: `https://share.specter.test/${input.sessionId}` },
      }
    },
    async unshareSession(input) {
      calls.push(`sessionUnshare:${input.sessionId}`)
      return { id: input.sessionId, title: 'Main session' }
    },
    async unrevertSession(input) {
      calls.push(`sessionUnrevert:${input.sessionId}`)
      return { id: input.sessionId, title: 'Main session', reverted: false }
    },
    async listPtyShells(input) {
      calls.push(`ptyShells:${input.workspaceRoot ?? ''}`)
      return [{ path: '/bin/sh', name: 'sh', acceptable: true }]
    },
    async listPtySessions(input) {
      calls.push(`ptyList:${input.workspaceRoot ?? ''}`)
      return [
        {
          id: 'pty-main',
          sessionId: 'session-main',
          status: 'running',
          shell: '/bin/sh',
          cwd: '.',
          absoluteCwd: '/repo',
          startedAt: '2026-06-25T00:00:00.000Z',
        },
      ]
    },
    async startPtySession(input) {
      calls.push(
        `ptyStart:${input.sessionId}:${input.workspaceRoot}:${input.cwd ?? ''}:${input.shell ?? ''}`,
      )
      return {
        id: 'pty-main',
        sessionId: input.sessionId,
        status: 'running',
        shell: input.shell ?? '/bin/sh',
        cwd: input.cwd ?? '.',
        absoluteCwd: input.workspaceRoot,
        startedAt: '2026-06-25T00:00:00.000Z',
      }
    },
    async getPtySession(input) {
      calls.push(`ptyGet:${input.ptySessionId}`)
      return {
        id: input.ptySessionId,
        sessionId: 'session-main',
        status: 'running',
        shell: '/bin/sh',
        cwd: '.',
        absoluteCwd: '/repo',
        startedAt: '2026-06-25T00:00:00.000Z',
      }
    },
    async updatePtySession(input) {
      calls.push(
        `ptyUpdate:${input.ptySessionId}:${input.title ?? ''}:${input.size?.rows ?? ''}x${input.size?.cols ?? ''}`,
      )
      return {
        id: input.ptySessionId,
        sessionId: 'session-main',
        status: 'running',
        shell: '/bin/sh',
        cwd: '.',
        absoluteCwd: '/repo',
        title: input.title,
        size: input.size,
        startedAt: '2026-06-25T00:00:00.000Z',
      }
    },
    async stopPtySession(input) {
      calls.push(`ptyStop:${input.ptySessionId}`)
      return true
    },
    async createPtyConnectToken(input) {
      calls.push(`ptyToken:${input.ptySessionId}`)
      return { ticket: `ticket-${input.ptySessionId}`, expires_in: 30 }
    },
    async connectPtySession(input) {
      calls.push(`ptyConnect:${input.ptySessionId}`)
      return true
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
      { method: 'GET', normalizedPath: '/experimental/tool' },
      { method: 'GET', normalizedPath: '/experimental/tool/ids' },
      { method: 'GET', normalizedPath: '/formatter' },
      { method: 'GET', normalizedPath: '/global/config' },
      { method: 'PATCH', normalizedPath: '/global/config' },
      { method: 'GET', normalizedPath: '/global/event' },
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
      { method: 'POST', normalizedPath: '/project/git/init' },
      { method: 'PATCH', normalizedPath: '/project/:projectID' },
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
      { method: 'POST', normalizedPath: '/session/:sessionID/init' },
      { method: 'PATCH', normalizedPath: '/session/:sessionID' },
      { method: 'GET', normalizedPath: '/session/:sessionID/diff' },
      { method: 'GET', normalizedPath: '/session/:sessionID/message' },
      { method: 'GET', normalizedPath: '/session/:sessionID/message/:messageID' },
      { method: 'DELETE', normalizedPath: '/session/:sessionID/message/:messageID' },
      { method: 'PATCH', normalizedPath: '/session/:sessionID/message/:messageID/part/:partID' },
      { method: 'DELETE', normalizedPath: '/session/:sessionID/message/:messageID/part/:partID' },
      { method: 'POST', normalizedPath: '/session/:sessionID/permissions/:permissionID' },
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
    ])
  })

  it('updates project metadata and initializes git through OpenCode project mutation routes', async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'specter-code-project-api-'))
    try {
      const router = createSpecterCodeApiRouter()
      const projectUrl = `http://specter.test/project/${encodeURIComponent(workspaceRoot)}?directory=${encodeURIComponent(workspaceRoot)}`

      const patchResponse = await router.handle(
        new Request(projectUrl, {
          method: 'PATCH',
          body: JSON.stringify({
            name: 'Renamed Project',
            icon: '🚀',
            commands: { test: 'pnpm test' },
          }),
        }),
      )

      expect(patchResponse.status).toBe(200)
      await expect(json(patchResponse)).resolves.toEqual(
        expect.objectContaining({
          id: workspaceRoot,
          directory: workspaceRoot,
          name: 'Renamed Project',
          icon: '🚀',
          commands: { test: 'pnpm test' },
        }),
      )
      await expect(
        readFile(path.join(workspaceRoot, '.opencode', 'opencode.jsonc'), 'utf8').then(JSON.parse),
      ).resolves.toEqual(
        expect.objectContaining({
          project: {
            name: 'Renamed Project',
            icon: '🚀',
            commands: { test: 'pnpm test' },
          },
        }),
      )

      const initResponse = await router.handle(
        new Request(
          `http://specter.test/project/git/init?directory=${encodeURIComponent(workspaceRoot)}`,
          { method: 'POST' },
        ),
      )

      expect(initResponse.status).toBe(200)
      await expect(json(initResponse)).resolves.toEqual(
        expect.objectContaining({
          id: workspaceRoot,
          directory: workspaceRoot,
          name: 'Renamed Project',
          vcs: 'git',
          worktree: workspaceRoot,
        }),
      )
      await expect(access(path.join(workspaceRoot, '.git'))).resolves.toBeUndefined()
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('dispatches OpenCode session status, prompt message, and abort routes to runtime handlers', async () => {
    const runtime = createRuntime()
    const router = createSpecterCodeApiRouter({ runtime })

    await expect(
      json(await router.handle(new Request('http://specter.test/session/status?directory=/repo'))),
    ).resolves.toEqual({
      'session-main': { status: 'idle', sessionId: 'session-main' },
    })

    await expect(
      json(
        await router.handle(
          new Request('http://specter.test/session/session-main/message', {
            method: 'POST',
            body: JSON.stringify({
              messageID: 'msg_api',
              agent: 'build',
              noReply: true,
              model: {
                providerID: 'openrouter',
                modelID: 'anthropic/claude-sonnet-4',
              },
              parts: [
                { type: 'text', text: 'hello' },
                { type: 'text', text: 'world' },
              ],
            }),
          }),
        ),
      ),
    ).resolves.toEqual({
      info: { id: 'msg_api', sessionID: 'session-main', role: 'assistant' },
      parts: [],
    })

    await expect(
      json(
        await router.handle(
          new Request('http://specter.test/session/session-main/abort', { method: 'POST' }),
        ),
      ),
    ).resolves.toBe(true)

    expect(runtime.calls.slice(-3)).toEqual([
      'sessionStatus:/repo',
      'sessionMessage:session-main:msg_api:build:no-reply:hello\n\nworld',
      'abortSession:session-main',
    ])
  })

  it('dispatches OpenCode session share, unshare, and unrevert routes to runtime handlers', async () => {
    const runtime = createRuntime()
    const router = createSpecterCodeApiRouter({ runtime })

    await expect(
      json(
        await router.handle(
          new Request('http://specter.test/session/session-main/share', { method: 'POST' }),
        ),
      ),
    ).resolves.toEqual({
      id: 'session-main',
      title: 'Main session',
      share: { url: 'https://share.specter.test/session-main' },
    })

    await expect(
      json(
        await router.handle(
          new Request('http://specter.test/session/session-main/share', { method: 'DELETE' }),
        ),
      ),
    ).resolves.toEqual({
      id: 'session-main',
      title: 'Main session',
    })

    await expect(
      json(
        await router.handle(
          new Request('http://specter.test/session/session-main/unrevert', { method: 'POST' }),
        ),
      ),
    ).resolves.toEqual({
      id: 'session-main',
      title: 'Main session',
      reverted: false,
    })

    expect(runtime.calls.slice(-3)).toEqual([
      'sessionShare:session-main',
      'sessionUnshare:session-main',
      'sessionUnrevert:session-main',
    ])
  })

  it('dispatches OpenCode session message detail and message-part mutation routes to runtime handlers', async () => {
    const runtime = createRuntime() as ReturnType<typeof createRuntime> & {
      getSessionMessage(input: { sessionId: string; messageId: string }): Promise<unknown>
      deleteSessionMessage(input: { sessionId: string; messageId: string }): Promise<unknown>
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
    }
    runtime.getSessionMessage = async (input) => {
      runtime.calls.push(`messageGet:${input.sessionId}:${input.messageId}`)
      return {
        info: { id: input.messageId, sessionID: input.sessionId, role: 'user' },
        parts: [{ id: 'part_text', type: 'text', text: 'hello' }],
      }
    }
    runtime.deleteSessionMessage = async (input) => {
      runtime.calls.push(`messageDelete:${input.sessionId}:${input.messageId}`)
      return true
    }
    runtime.updateSessionMessagePart = async (input) => {
      runtime.calls.push(
        `partPatch:${input.sessionId}:${input.messageId}:${input.partId}:${input.text}`,
      )
      return {
        info: { id: input.messageId, sessionID: input.sessionId, role: 'user' },
        parts: [{ id: input.partId, type: 'text', text: input.text }],
      }
    }
    runtime.deleteSessionMessagePart = async (input) => {
      runtime.calls.push(
        `partDelete:${input.sessionId}:${input.messageId}:${input.partId}`,
      )
      return {
        info: { id: input.messageId, sessionID: input.sessionId, role: 'user' },
        parts: [],
      }
    }
    const router = createSpecterCodeApiRouter({ runtime })

    await expect(
      json(await router.handle(new Request('http://specter.test/session/session-main/message/msg_1'))),
    ).resolves.toEqual({
      info: { id: 'msg_1', sessionID: 'session-main', role: 'user' },
      parts: [{ id: 'part_text', type: 'text', text: 'hello' }],
    })

    await expect(
      json(
        await router.handle(
          new Request('http://specter.test/session/session-main/message/msg_1/part/part_text', {
            method: 'PATCH',
            body: JSON.stringify({ text: 'updated text' }),
          }),
        ),
      ),
    ).resolves.toEqual({
      info: { id: 'msg_1', sessionID: 'session-main', role: 'user' },
      parts: [{ id: 'part_text', type: 'text', text: 'updated text' }],
    })

    await expect(
      json(
        await router.handle(
          new Request('http://specter.test/session/session-main/message/msg_1/part/part_text', {
            method: 'DELETE',
          }),
        ),
      ),
    ).resolves.toEqual({
      info: { id: 'msg_1', sessionID: 'session-main', role: 'user' },
      parts: [],
    })

    await expect(
      json(
        await router.handle(
          new Request('http://specter.test/session/session-main/message/msg_1', {
            method: 'DELETE',
          }),
        ),
      ),
    ).resolves.toBe(true)

    expect(runtime.calls.slice(-4)).toEqual([
      'messageGet:session-main:msg_1',
      'partPatch:session-main:msg_1:part_text:updated text',
      'partDelete:session-main:msg_1:part_text',
      'messageDelete:session-main:msg_1',
    ])
  })

  it('dispatches OpenCode command list and session command routes to runtime handlers', async () => {
    const runtime = createRuntime()
    const router = createSpecterCodeApiRouter({ runtime })

    await expect(
      json(
        await router.handle(
          new Request('http://specter.test/command?directory=/repo'),
        ),
      ),
    ).resolves.toEqual([
      {
        name: 'fix',
        description: 'Fix a file',
        source: 'command',
        template: 'Fix $1: $ARGUMENTS',
        hints: ['$1', '$ARGUMENTS'],
      },
    ])

    await expect(
      json(
        await router.handle(
          new Request('http://specter.test/session/session-main/command?directory=/repo', {
            method: 'POST',
            body: JSON.stringify({
              command: 'fix',
              arguments: 'src/app.ts with tests',
              messageID: 'msg_cmd',
              agent: 'plan',
              model: { providerID: 'openrouter', modelID: 'anthropic/claude-sonnet-4' },
            }),
          }),
        ),
      ),
    ).resolves.toEqual({
      info: { id: 'msg_cmd', sessionID: 'session-main', role: 'assistant' },
      parts: [],
    })

    expect(runtime.calls.slice(-2)).toEqual([
      'commands:/repo',
      'sessionCommand:session-main:msg_cmd:/repo:fix:src/app.ts with tests:plan:openrouter/anthropic/claude-sonnet-4',
    ])
  })


  it('dispatches OpenCode session action routes to runtime handlers', async () => {
    const runtime = createRuntime()
    const router = createSpecterCodeApiRouter({ runtime })

    await expect(
      json(
        await router.handle(
          new Request('http://specter.test/session/session-main/init?directory=/repo', {
            method: 'POST',
            body: JSON.stringify({
              messageID: 'msg_init',
              providerID: 'openrouter',
              modelID: 'anthropic/claude-sonnet-4',
            }),
          }),
        ),
      ),
    ).resolves.toBe(true)

    await expect(
      json(
        await router.handle(
          new Request('http://specter.test/session/session-main/summarize?directory=/repo', {
            method: 'POST',
            body: JSON.stringify({
              providerID: 'openrouter',
              modelID: 'anthropic/claude-sonnet-4',
              auto: true,
            }),
          }),
        ),
      ),
    ).resolves.toBe(true)

    await expect(
      json(
        await router.handle(
          new Request('http://specter.test/session/session-main/shell?directory=/repo', {
            method: 'POST',
            body: JSON.stringify({
              messageID: 'msg_shell',
              agent: 'build',
              command: 'pnpm test',
              model: { providerID: 'openrouter', modelID: 'anthropic/claude-sonnet-4' },
            }),
          }),
        ),
      ),
    ).resolves.toEqual({
      info: { id: 'msg_shell', sessionID: 'session-main', role: 'assistant' },
      parts: [],
    })

    const compact = await router.handle(
      new Request('http://specter.test/api/session/session-main/compact?directory=/repo', {
        method: 'POST',
      }),
    )
    expect(compact.status).toBe(204)

    const wait = await router.handle(
      new Request('http://specter.test/api/session/session-main/wait?directory=/repo', {
        method: 'POST',
      }),
    )
    expect(wait.status).toBe(204)

    await expect(
      json(await router.handle(new Request('http://specter.test/api/session/session-main/context'))),
    ).resolves.toEqual([{ id: 'message-1', role: 'user', content: 'active prompt' }])

    expect(runtime.calls.slice(-6)).toEqual([
      'sessionInit:session-main:msg_init:/repo:openrouter/anthropic/claude-sonnet-4',
      'sessionSummarize:session-main:/repo:openrouter/anthropic/claude-sonnet-4:auto',
      'sessionShell:session-main:msg_shell:/repo:build:pnpm test:openrouter/anthropic/claude-sonnet-4',
      'sessionCompact:session-main:/repo',
      'sessionWait:session-main:/repo',
      'context:session-main',
    ])
  })

  it('dispatches OpenCode MCP status, add, connect, and disconnect routes to runtime handlers', async () => {
    const runtime = {
      ...createRuntime(),
      async listMcpStatus(input: { workspaceRoot: string }) {
        this.calls.push(`mcpStatus:${input.workspaceRoot}`)
        return {
          local: {
            type: 'local',
            name: 'local',
            status: 'connected',
          },
        }
      },
      async addMcpServer(input: {
        workspaceRoot: string
        name: string
        config: unknown
      }) {
        this.calls.push(
          `mcpAdd:${input.workspaceRoot}:${input.name}:${JSON.stringify(input.config)}`,
        )
        return {
          [input.name]: {
            type: 'local',
            name: input.name,
            status: 'disconnected',
          },
        }
      },
      async connectMcpServer(input: { workspaceRoot: string; name: string }) {
        this.calls.push(`mcpConnect:${input.workspaceRoot}:${input.name}`)
        return true
      },
      async disconnectMcpServer(input: {
        workspaceRoot: string
        name: string
      }) {
        this.calls.push(`mcpDisconnect:${input.workspaceRoot}:${input.name}`)
        return true
      },
    }
    const router = createSpecterCodeApiRouter({ runtime })

    await expect(
      json(
        await router.handle(
          new Request('http://specter.test/mcp?directory=/repo'),
        ),
      ),
    ).resolves.toEqual({
      local: { type: 'local', name: 'local', status: 'connected' },
    })

    await expect(
      json(
        await router.handle(
          new Request('http://specter.test/mcp?workspace=/repo', {
            method: 'POST',
            body: JSON.stringify({
              name: 'filesystem',
              config: {
                type: 'local',
                command: ['node', 'mcp-server.js'],
                enabled: true,
              },
            }),
          }),
        ),
      ),
    ).resolves.toEqual({
      filesystem: { type: 'local', name: 'filesystem', status: 'disconnected' },
    })

    await expect(
      json(
        await router.handle(
          new Request(
            'http://specter.test/mcp/filesystem/connect?directory=/repo',
            { method: 'POST' },
          ),
        ),
      ),
    ).resolves.toBe(true)

    await expect(
      json(
        await router.handle(
          new Request(
            'http://specter.test/mcp/filesystem/disconnect?directory=/repo',
            { method: 'POST' },
          ),
        ),
      ),
    ).resolves.toBe(true)

    expect(runtime.calls.slice(-4)).toEqual([
      'mcpStatus:/repo',
      'mcpAdd:/repo:filesystem:{"type":"local","command":["node","mcp-server.js"],"enabled":true}',
      'mcpConnect:/repo:filesystem',
      'mcpDisconnect:/repo:filesystem',
    ])
  })

  it('dispatches OpenCode experimental tool list routes to runtime handlers', async () => {
    const runtime = {
      ...createRuntime(),
      async listToolIds(input: { workspaceRoot: string }) {
        this.calls.push(`toolIds:${input.workspaceRoot}`)
        return ['grep', 'read']
      },
      async listTools(input: {
        workspaceRoot: string
        providerId: string
        modelId: string
      }) {
        this.calls.push(
          `tools:${input.workspaceRoot}:${input.providerId}/${input.modelId}`,
        )
        return [
          {
            id: 'read',
            description: 'Read a file inside the current workspace',
            parameters: { type: 'object' },
          },
        ]
      },
    }
    const router = createSpecterCodeApiRouter({ runtime })

    await expect(
      json(
        await router.handle(
          new Request('http://specter.test/experimental/tool/ids?directory=/repo'),
        ),
      ),
    ).resolves.toEqual(['grep', 'read'])

    await expect(
      json(
        await router.handle(
          new Request(
            'http://specter.test/experimental/tool?directory=/repo&provider=openrouter&model=test-model',
          ),
        ),
      ),
    ).resolves.toEqual([
      {
        id: 'read',
        description: 'Read a file inside the current workspace',
        parameters: { type: 'object' },
      },
    ])

    expect(runtime.calls.slice(-2)).toEqual([
      'toolIds:/repo',
      'tools:/repo:openrouter/test-model',
    ])
  })

  it('dispatches session, file, permission, config, provider, agent, and event requests to runtime handlers', async () => {
    const runtime = createRuntime()
    const router = createSpecterCodeApiRouter({ runtime })

    await expect(
      json(
        await router.handle(
          new Request('http://specter.test/session?workspaceId=workspace-main'),
        ),
      ),
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
              model: {
                providerId: 'openrouter',
                modelId: 'anthropic/claude-sonnet-4',
              },
            }),
          }),
        ),
      ),
    ).resolves.toEqual({ id: 'session-main', title: 'Implement API routes' })

    await expect(
      json(
        await router.handle(
          new Request('http://specter.test/session/session-main'),
        ),
      ),
    ).resolves.toEqual({
      id: 'session-main',
      title: 'Main session',
      workspaceId: 'workspace-main',
    })

    await expect(
      json(
        await router.handle(
          new Request('http://specter.test/session/session-main', {
            method: 'PATCH',
            body: JSON.stringify({ title: 'Renamed session' }),
          }),
        ),
      ),
    ).resolves.toEqual({
      id: 'session-main',
      title: 'Renamed session',
      workspaceId: 'workspace-main',
    })

    await expect(
      json(
        await router.handle(
          new Request('http://specter.test/session/session-main', {
            method: 'DELETE',
          }),
        ),
      ),
    ).resolves.toBe(true)

    await expect(
      json(
        await router.handle(
          new Request('http://specter.test/session/session-main/message'),
        ),
      ),
    ).resolves.toEqual([
      { id: 'message-1', role: 'assistant', content: 'done' },
    ])

    await expect(
      json(
        await router.handle(
          new Request('http://specter.test/session/session-main/todo'),
        ),
      ),
    ).resolves.toEqual([
      { id: 'todo-1', content: 'Ship API route', status: 'in_progress' },
    ])

    await expect(
      json(
        await router.handle(
          new Request('http://specter.test/session/session-main/children'),
        ),
      ),
    ).resolves.toEqual([
      {
        id: 'session-child',
        parentSessionId: 'session-main',
        title: 'Child session',
      },
    ])

    await expect(
      json(
        await router.handle(
          new Request('http://specter.test/session/session-main/fork', {
            method: 'POST',
            body: JSON.stringify({
              sessionId: 'session-child',
              title: 'Investigate in child',
            }),
          }),
        ),
      ),
    ).resolves.toEqual({
      id: 'session-child',
      parentSessionId: 'session-main',
      title: 'Investigate in child',
    })

    await expect(
      json(
        await router.handle(
          new Request('http://specter.test/session/session-main/prompt_async', {
            method: 'POST',
            body: JSON.stringify({
              workspaceId: 'workspace-main',
              content: 'ship it',
              agentId: 'build',
            }),
          }),
        ),
      ),
    ).resolves.toEqual({
      runId: 'generated-run',
      messageId: 'generated-message',
    })

    await expect(
      json(
        await router.handle(
          new Request(
            'http://specter.test/file?workspaceId=workspace-main&path=src',
          ),
        ),
      ),
    ).resolves.toEqual([{ path: 'src/index.ts', type: 'file' }])

    await expect(
      json(
        await router.handle(
          new Request(
            'http://specter.test/file/content?workspaceId=workspace-main&path=src/index.ts',
          ),
        ),
      ),
    ).resolves.toEqual({ content: 'export const value = 1\n' })

    await expect(
      json(
        await router.handle(
          new Request(
            'http://specter.test/file/status?workspaceId=workspace-main',
          ),
        ),
      ),
    ).resolves.toEqual({ initialized: true, latestScan: null })

    await expect(
      json(
        await router.handle(
          new Request('http://specter.test/permission?sessionId=session-main'),
        ),
      ),
    ).resolves.toEqual([{ requestId: 'request-1', action: 'ask' }])

    await expect(
      json(
        await router.handle(
          new Request('http://specter.test/permission/request-1/reply', {
            method: 'POST',
            body: JSON.stringify({
              sessionId: 'session-main',
              action: 'allow',
            }),
          }),
        ),
      ),
    ).resolves.toEqual({ requestId: 'request-1', action: 'allow' })

    await expect(
      json(
        await router.handle(
          new Request('http://specter.test/config?workspaceRoot=/repo'),
        ),
      ),
    ).resolves.toEqual({
      sources: [],
      permissionRules: [],
      raw: { model: 'openrouter/test' },
    })
    await expect(
      json(await router.handle(new Request('http://specter.test/provider'))),
    ).resolves.toEqual([{ id: 'openrouter', configured: false, models: [] }])
    await expect(
      json(await router.handle(new Request('http://specter.test/agent'))),
    ).resolves.toEqual([{ id: 'build', default: true, tools: ['read'] }])

    await expect(
      json(await router.handle(new Request('http://specter.test/question'))),
    ).resolves.toEqual([
      {
        questionId: 'question-1',
        sessionId: 'session-main',
        messageId: 'message-1',
        prompt: 'Run tests?',
        options: [],
        allowFreeform: true,
      },
    ])

    await expect(
      json(
        await router.handle(
          new Request('http://specter.test/question/question-1/reply', {
            method: 'POST',
            body: JSON.stringify({
              answers: [['Safe migration', 'Run tests']],
            }),
          }),
        ),
      ),
    ).resolves.toBe(true)

    await expect(
      json(
        await router.handle(
          new Request('http://specter.test/question/question-2/reject', {
            method: 'POST',
            body: JSON.stringify({ reason: 'Need manual review' }),
          }),
        ),
      ),
    ).resolves.toBe(true)

    await expect(
      json(
        await router.handle(
          new Request('http://specter.test/skill?directory=/repo'),
        ),
      ),
    ).resolves.toEqual([
      {
        name: 'review',
        description: 'Review local code changes',
        location: '/repo/.opencode/skills/review/SKILL.md',
        content: '# Review\n',
      },
    ])

    await expect(
      json(
        await router.handle(
          new Request(
            'http://specter.test/find/file?directory=/repo&query=index&limit=25',
          ),
        ),
      ),
    ).resolves.toEqual(['src/index.ts'])

    await expect(
      json(
        await router.handle(
          new Request(
            'http://specter.test/find?directory=/repo&pattern=value&limit=10',
          ),
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
      json(
        await router.handle(
          new Request(
            'http://specter.test/find/symbol?directory=/repo&query=value&limit=5',
          ),
        ),
      ),
    ).resolves.toEqual([
      {
        path: 'src/index.ts',
        lineNumber: 1,
        name: 'makeValue',
        kind: 'function',
      },
    ])

    await expect(
      json(
        await router.handle(
          new Request(
            'http://specter.test/lsp?directory=/repo&include=src/index.ts',
          ),
        ),
      ),
    ).resolves.toEqual([
      {
        path: 'src/index.ts',
        lineNumber: 1,
        column: 14,
        category: 'error',
        code: 2322,
        message: "Type 'string' is not assignable to type 'number'",
      },
    ])

    await expect(
      json(
        await router.handle(
          new Request('http://specter.test/vcs?workspaceRoot=/repo'),
        ),
      ),
    ).resolves.toEqual({
      branch: 'threadplane-work',
      clean: false,
      entries: [{ path: 'src/index.ts', index: ' ', workingTree: 'M' }],
    })

    await expect(
      json(
        await router.handle(
          new Request('http://specter.test/vcs/status?workspaceRoot=/repo'),
        ),
      ),
    ).resolves.toEqual({
      branch: 'threadplane-work',
      clean: false,
      entries: [{ path: 'src/index.ts', index: ' ', workingTree: 'M' }],
    })

    await expect(
      json(
        await router.handle(
          new Request(
            'http://specter.test/vcs/diff?workspaceRoot=/repo&path=src/index.ts&staged=true',
          ),
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
            body: JSON.stringify({
              workspaceRoot: '/repo',
              patch: 'diff --git a/src/index.ts b/src/index.ts\n',
              staged: false,
            }),
          }),
        ),
      ),
    ).resolves.toEqual({ paths: ['src/index.ts'], staged: false })

    await expect(
      json(
        await router.handle(
          new Request(
            'http://specter.test/session/session-main/diff?workspaceRoot=/repo&path=src/index.ts&staged=true',
          ),
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
          new Request('http://specter.test/session/session-main/revert', {
            method: 'POST',
            body: JSON.stringify({
              workspaceRoot: '/repo',
              paths: ['src/index.ts'],
            }),
          }),
        ),
      ),
    ).resolves.toEqual({ paths: ['src/index.ts'] })

    await expect(
      json(
        await router.handle(
          new Request('http://specter.test/pty/shells?directory=/repo'),
        ),
      ),
    ).resolves.toEqual([{ path: '/bin/sh', name: 'sh', acceptable: true }])

    await expect(
      json(
        await router.handle(
          new Request('http://specter.test/pty?directory=/repo'),
        ),
      ),
    ).resolves.toEqual([
      {
        id: 'pty-main',
        sessionId: 'session-main',
        status: 'running',
        shell: '/bin/sh',
        cwd: '.',
        absoluteCwd: '/repo',
        startedAt: '2026-06-25T00:00:00.000Z',
      },
    ])

    await expect(
      json(
        await router.handle(
          new Request('http://specter.test/pty?directory=/repo', {
            method: 'POST',
            body: JSON.stringify({
              sessionId: 'session-main',
              command: '/bin/sh',
              cwd: '.',
            }),
          }),
        ),
      ),
    ).resolves.toEqual({
      id: 'pty-main',
      sessionId: 'session-main',
      status: 'running',
      shell: '/bin/sh',
      cwd: '.',
      absoluteCwd: '/repo',
      startedAt: '2026-06-25T00:00:00.000Z',
    })

    await expect(
      json(
        await router.handle(new Request('http://specter.test/pty/pty-main')),
      ),
    ).resolves.toEqual({
      id: 'pty-main',
      sessionId: 'session-main',
      status: 'running',
      shell: '/bin/sh',
      cwd: '.',
      absoluteCwd: '/repo',
      startedAt: '2026-06-25T00:00:00.000Z',
    })

    await expect(
      json(
        await router.handle(
          new Request('http://specter.test/pty/pty-main', {
            method: 'PUT',
            body: JSON.stringify({
              title: 'Tests',
              size: { rows: 24, cols: 80 },
            }),
          }),
        ),
      ),
    ).resolves.toEqual({
      id: 'pty-main',
      sessionId: 'session-main',
      status: 'running',
      shell: '/bin/sh',
      cwd: '.',
      absoluteCwd: '/repo',
      title: 'Tests',
      size: { rows: 24, cols: 80 },
      startedAt: '2026-06-25T00:00:00.000Z',
    })

    await expect(
      json(
        await router.handle(
          new Request('http://specter.test/pty/pty-main/connect-token', {
            method: 'POST',
          }),
        ),
      ),
    ).resolves.toEqual({ ticket: 'ticket-pty-main', expires_in: 30 })

    await expect(
      json(
        await router.handle(
          new Request('http://specter.test/pty/pty-main/connect'),
        ),
      ),
    ).resolves.toBe(true)

    await expect(
      json(
        await router.handle(
          new Request('http://specter.test/pty/pty-main', { method: 'DELETE' }),
        ),
      ),
    ).resolves.toBe(true)

    const eventResponse = await router.handle(
      new Request('http://specter.test/event?after=1&live=false'),
    )
    expect(eventResponse.headers.get('content-type')).toBe(
      'text/event-stream; charset=utf-8',
    )
    await expect(eventResponse.text()).resolves.toBe(
      'id: 2\n' +
        'event: agentRunCompleted\n' +
        'data: {"id":"event-2","order":2,"type":"agentRunCompleted","payload":{"runId":"run-1"},"recordedAt":"2026-06-24T12:00:02.000Z"}\n\n',
    )

    expect(runtime.calls).toEqual([
      'listSessions:workspace-main',
      'createSession:session-main:workspace-main:Implement API routes',
      'getSession:session-main',
      'updateSession:session-main:Renamed session',
      'deleteSession:session-main',
      'transcript:session-main',
      'sessionTodos:session-main',
      'sessionChildren:session-main',
      'forkSession:session-main:session-child:Investigate in child',
      'submitPrompt:session-main:workspace-main:ship it',
      'fileTree:workspace-main:src',
      'readFile:workspace-main:src/index.ts',
      'fileStatus:workspace-main',
      'permissions:session-main',
      'replyPermission:request-1:session-main:allow',
      'config:/repo',
      'providers',
      'agents',
      'questions:all',
      'replyQuestion:question-1:Safe migration,Run tests',
      'rejectQuestion:question-2:Need manual review',
      'skills:/repo',
      'findFiles:/repo:index:25',
      'findText:/repo:value',
      'findSymbols:/repo:value:5',
      'lspDiagnostics:/repo:src/index.ts',
      'vcsStatus:/repo',
      'vcsStatus:/repo',
      'vcsDiff:/repo:src/index.ts:staged',
      'vcsApply:/repo:unstaged',
      'vcsDiff:/repo:src/index.ts:staged',
      'sessionRevert:session-main:/repo:src/index.ts',
      'ptyShells:/repo',
      'ptyList:/repo',
      'ptyStart:session-main:/repo:.:/bin/sh',
      'ptyGet:pty-main',
      'ptyUpdate:pty-main:Tests:24x80',
      'ptyToken:pty-main',
      'ptyConnect:pty-main',
      'ptyStop:pty-main',
      'events:1',
    ])
  })

  it('dispatches OpenCode API alias, project-current, path, health, config providers, and raw diff routes', async () => {
    const runtime = createRuntime()
    const router = createSpecterCodeApiRouter({ runtime })

    await expect(
      json(await router.handle(new Request('http://specter.test/api/provider'))),
    ).resolves.toEqual([{ id: 'openrouter', configured: false, models: [] }])

    await expect(
      json(await router.handle(new Request('http://specter.test/api/model'))),
    ).resolves.toEqual([{ id: 'openrouter', configured: false, models: [] }])

    await expect(
      json(
        await router.handle(
          new Request('http://specter.test/api/session?workspaceId=workspace-main'),
        ),
      ),
    ).resolves.toEqual([{ id: 'session-main', title: 'Main session' }])

    await expect(
      json(
        await router.handle(
          new Request('http://specter.test/api/session/session-main/message'),
        ),
      ),
    ).resolves.toEqual([{ id: 'message-1', role: 'assistant', content: 'done' }])

    await expect(
      json(
        await router.handle(
          new Request('http://specter.test/api/session/session-main/prompt', {
            method: 'POST',
            body: JSON.stringify({
              workspaceId: 'workspace-main',
              messageID: 'message-api-prompt',
              parts: [{ type: 'text', text: 'run the focused tests' }],
              agent: 'build',
            }),
          }),
        ),
      ),
    ).resolves.toEqual({ runId: 'generated-run', messageId: 'message-api-prompt' })

    await expect(
      json(await router.handle(new Request('http://specter.test/config/providers?directory=/repo'))),
    ).resolves.toEqual([{ id: 'openrouter', configured: false, models: [] }])

    await expect(
      json(await router.handle(new Request('http://specter.test/project/current?directory=/repo'))),
    ).resolves.toEqual({
      id: '/repo',
      directory: '/repo',
      name: 'repo',
      configSources: ['/repo/.opencode/opencode.jsonc'],
    })

    await expect(
      json(await router.handle(new Request('http://specter.test/path?directory=/repo/src'))),
    ).resolves.toEqual({ path: '/repo/src', directory: '/repo/src' })

    await expect(
      json(await router.handle(new Request('http://specter.test/global/health'))),
    ).resolves.toEqual({ ok: true })

    const rawDiff = await router.handle(
      new Request('http://specter.test/vcs/diff/raw?workspaceRoot=/repo&path=src/index.ts&staged=true'),
    )
    expect(rawDiff.headers.get('content-type')).toContain('text/plain')
    await expect(rawDiff.text()).resolves.toBe('diff --git a/src/index.ts b/src/index.ts\n')

    expect(runtime.calls).toEqual([
      'providers',
      'providers',
      'listSessions:workspace-main',
      'transcript:session-main',
      'submitPrompt:session-main:workspace-main:run the focused tests',
      'providers',
      'projects:/repo',
      'vcsDiff:/repo:src/index.ts:staged',
    ])
  })


  it('dispatches OpenCode project, formatter, and config update routes to runtime handlers', async () => {
    const runtime = createRuntime()
    const router = createSpecterCodeApiRouter({ runtime })

    await expect(
      json(await router.handle(new Request('http://specter.test/project?directory=/repo'))),
    ).resolves.toEqual([
      {
        id: '/repo',
        directory: '/repo',
        name: 'repo',
        configSources: ['/repo/.opencode/opencode.jsonc'],
      },
    ])

    await expect(
      json(await router.handle(new Request('http://specter.test/formatter?workspace=/repo'))),
    ).resolves.toEqual([
      {
        name: 'prettier',
        command: 'pnpm prettier --check .',
        enabled: true,
      },
    ])

    await expect(
      json(await router.handle(new Request('http://specter.test/global/config?directory=/repo'))),
    ).resolves.toEqual({
      sources: [],
      permissionRules: [],
      raw: { model: 'openrouter/test' },
    })

    await expect(
      json(
        await router.handle(
          new Request('http://specter.test/global/config?directory=/repo', {
            method: 'PATCH',
            body: JSON.stringify({
              model: 'openrouter/test-model',
              default_agent: 'build',
            }),
          }),
        ),
      ),
    ).resolves.toEqual({
      sources: ['/repo/.opencode/opencode.jsonc'],
      permissionRules: [],
      raw: { model: 'openrouter/test-model', default_agent: 'build' },
    })

    expect(runtime.calls.slice(-4)).toEqual([
      'projects:/repo',
      'formatters:/repo',
      'config:/repo',
      'configPatch:/repo:{"model":"openrouter/test-model","default_agent":"build"}',
    ])
  })

  it('dispatches OpenCode global event and provider detail aliases to existing runtime handlers', async () => {
    const runtime = createRuntime()
    const router = createSpecterCodeApiRouter({ runtime })

    await expect(
      json(await router.handle(new Request('http://specter.test/api/provider/openrouter'))),
    ).resolves.toEqual({ id: 'openrouter', configured: false, models: [] })

    const eventStream = await router.handle(
      new Request('http://specter.test/global/event?after=1&live=false'),
    )
    expect(eventStream.status).toBe(200)
    expect(eventStream.headers.get('content-type')).toContain('text/event-stream')
    await expect(eventStream.text()).resolves.toContain('agentRunCompleted')

    expect(runtime.calls.slice(-2)).toEqual(['providers', 'events:1'])
  })

  it('returns JSON errors for unmatched routes, invalid bodies, and missing query parameters', async () => {
    const router = createSpecterCodeApiRouter({ runtime: createRuntime() })

    const missingParam = await router.handle(
      new Request('http://specter.test/session'),
    )
    expect(missingParam.status).toBe(400)
    await expect(json(missingParam)).resolves.toEqual({
      error: 'Missing required query parameter: workspaceId',
    })

    const invalidJson = await router.handle(
      new Request('http://specter.test/session', { method: 'POST', body: '{' }),
    )
    expect(invalidJson.status).toBe(400)
    await expect(json(invalidJson)).resolves.toEqual({
      error: 'Invalid JSON request body',
    })

    const notFound = await router.handle(
      new Request('http://specter.test/unmatched'),
    )
    expect(notFound.status).toBe(404)
    await expect(json(notFound)).resolves.toEqual({
      error: 'No OpenCode-compatible route for GET /unmatched',
    })
  })
})

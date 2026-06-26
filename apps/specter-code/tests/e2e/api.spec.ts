import { execFile } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { expect, test } from '@playwright/test'

const execFileAsync = promisify(execFile)

test('serves OpenCode-compatible provider, agent, config, and event endpoints over HTTP', async ({ request }) => {
  const providers = await request.get('/provider')
  expect(providers.status()).toBe(200)
  expect(providers.headers()['content-type']).toContain('application/json')
  expect(await providers.json()).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: 'openrouter' })]),
  )

  const agents = await request.get('/agent')
  expect(agents.status()).toBe(200)
  expect(agents.headers()['content-type']).toContain('application/json')
  expect(await agents.json()).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: 'build' })]),
  )

  const workspaceRoot = process.cwd()
  const config = await request.get(`/config?workspaceRoot=${encodeURIComponent(workspaceRoot)}`)
  expect(config.status()).toBe(200)
  expect(config.headers()['content-type']).toContain('application/json')
  expect(await config.json()).toEqual(
    expect.objectContaining({
      sources: expect.any(Array),
      permissionRules: expect.any(Array),
      raw: expect.any(Object),
    }),
  )

  const findFiles = await request.get(
    `/find/file?directory=${encodeURIComponent(workspaceRoot)}&query=api-routes.ts&limit=5`,
  )
  expect(findFiles.status()).toBe(200)
  expect(await findFiles.json()).toEqual(
    expect.arrayContaining(['src/features/specter-code/api-routes.ts']),
  )

  const findText = await request.get(
    `/find?directory=${encodeURIComponent(workspaceRoot)}&pattern=workspaceRootFromFindQuery&limit=5`,
  )
  expect(findText.status()).toBe(200)
  expect(await findText.json()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        path: { text: 'src/features/specter-code/api-routes.ts' },
      }),
    ]),
  )

  const symbols = await request.get(
    `/find/symbol?directory=${encodeURIComponent(workspaceRoot)}&query=createSpecterCodeApiRouter&limit=5`,
  )
  expect(symbols.status()).toBe(200)
  expect(await symbols.json()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        path: 'src/features/specter-code/api-routes.ts',
        name: 'createSpecterCodeApiRouter',
        kind: 'function',
      }),
    ]),
  )

  const lsp = await request.get(
    `/lsp?directory=${encodeURIComponent(workspaceRoot)}&include=src/features/specter-code/api-routes.ts&limit=5`,
  )
  expect(lsp.status()).toBe(200)
  expect(lsp.headers()['content-type']).toContain('application/json')
  expect(await lsp.json()).toEqual(expect.any(Array))

  const mcpBeforeAdd = await request.get(`/mcp?directory=${encodeURIComponent(workspaceRoot)}`)
  expect(mcpBeforeAdd.status()).toBe(200)
  expect(mcpBeforeAdd.headers()['content-type']).toContain('application/json')
  expect(await mcpBeforeAdd.json()).toEqual(expect.any(Object))

  const toolIds = await request.get(
    `/experimental/tool/ids?directory=${encodeURIComponent(workspaceRoot)}`,
  )
  expect(toolIds.status()).toBe(200)
  expect(toolIds.headers()['content-type']).toContain('application/json')
  expect(await toolIds.json()).toEqual(
    expect.arrayContaining(['grep', 'read', 'write']),
  )

  const tools = await request.get(
    `/experimental/tool?directory=${encodeURIComponent(workspaceRoot)}&provider=openrouter&model=test-model`,
  )
  expect(tools.status()).toBe(200)
  expect(tools.headers()['content-type']).toContain('application/json')
  expect(await tools.json()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: 'read',
        description: 'Read a file inside the current workspace',
        parameters: expect.any(Object),
      }),
    ]),
  )

  const mcpAdd = await request.post(`/mcp?directory=${encodeURIComponent(workspaceRoot)}`, {
    data: { name: 'api-smoke', config: { type: 'local', command: ['node', 'server.js'] } },
  })
  expect(mcpAdd.status()).toBe(200)
  expect(await mcpAdd.json()).toEqual(
    expect.objectContaining({
      'api-smoke': expect.objectContaining({ name: 'api-smoke', status: 'disconnected' }),
    }),
  )

  const mcpConnect = await request.post(`/mcp/api-smoke/connect?directory=${encodeURIComponent(workspaceRoot)}`)
  expect(mcpConnect.status()).toBe(200)
  expect(await mcpConnect.json()).toBe(true)

  const mcpDisconnect = await request.post(`/mcp/api-smoke/disconnect?directory=${encodeURIComponent(workspaceRoot)}`)
  expect(mcpDisconnect.status()).toBe(200)
  expect(await mcpDisconnect.json()).toBe(true)

  const vcsStatus = await request.get(`/vcs/status?workspaceRoot=${encodeURIComponent(workspaceRoot)}`)
  expect(vcsStatus.status()).toBe(200)
  expect(vcsStatus.headers()['content-type']).toContain('application/json')
  expect(await vcsStatus.json()).toEqual(
    expect.objectContaining({
      clean: expect.any(Boolean),
      entries: expect.any(Array),
    }),
  )

  const vcsDiff = await request.get(`/vcs/diff?workspaceRoot=${encodeURIComponent(workspaceRoot)}`)
  expect(vcsDiff.status()).toBe(200)
  expect(vcsDiff.headers()['content-type']).toContain('application/json')
  expect(await vcsDiff.json()).toEqual(
    expect.objectContaining({
      patch: expect.any(String),
      staged: false,
    }),
  )

  const ptyShells = await request.get(`/pty/shells?directory=${encodeURIComponent(workspaceRoot)}`)
  expect(ptyShells.status()).toBe(200)
  expect(ptyShells.headers()['content-type']).toContain('application/json')
  expect(await ptyShells.json()).toEqual(
    expect.arrayContaining([expect.objectContaining({ path: expect.any(String), acceptable: true })]),
  )

  const ptySessions = await request.get(`/pty?directory=${encodeURIComponent(workspaceRoot)}`)
  expect(ptySessions.status()).toBe(200)
  expect(ptySessions.headers()['content-type']).toContain('application/json')
  expect(await ptySessions.json()).toEqual(expect.any(Array))

  const questions = await request.get('/question')
  expect(questions.status()).toBe(200)
  expect(questions.headers()['content-type']).toContain('application/json')
  expect(await questions.json()).toEqual(expect.any(Array))

  const missingQuestionReject = await request.post('/question/question-api-smoke/reject')
  expect(missingQuestionReject.status()).toBe(400)
  expect(missingQuestionReject.headers()['content-type']).toContain('application/json')
  expect(await missingQuestionReject.json()).toEqual({
    error: 'Pending question not found: question-api-smoke',
  })

  const skills = await request.get(`/skill?directory=${encodeURIComponent(workspaceRoot)}`)
  expect(skills.status()).toBe(200)
  expect(skills.headers()['content-type']).toContain('application/json')
  expect(await skills.json()).toEqual(expect.any(Array))

  const todos = await request.get('/session/session-api-smoke/todo')
  expect(todos.status()).toBe(200)
  expect(todos.headers()['content-type']).toContain('application/json')
  expect(await todos.json()).toEqual(expect.any(Array))

  const log = await request.post('/log', {
    data: { service: 'e2e', level: 'info', message: 'api smoke' },
  })
  expect(log.status()).toBe(200)
  expect(log.headers()['content-type']).toContain('application/json')
  expect(await log.json()).toBe(true)

  const syncStart = await request.post(`/sync/start?directory=${encodeURIComponent(workspaceRoot)}`)
  expect(syncStart.status()).toBe(200)
  expect(await syncStart.json()).toBe(true)

  const syncHistory = await request.post('/sync/history', { data: {} })
  expect(syncHistory.status()).toBe(200)
  expect(await syncHistory.json()).toEqual(expect.any(Array))

  const syncSteal = await request.post('/sync/steal', { data: { sessionID: 'session-api-smoke' } })
  expect(syncSteal.status()).toBe(200)
  expect(await syncSteal.json()).toEqual({ sessionID: 'session-api-smoke' })

  const globalUpgrade = await request.post('/global/upgrade', { data: { target: 'latest' } })
  expect(globalUpgrade.status()).toBe(200)
  expect(await globalUpgrade.json()).toEqual(
    expect.objectContaining({ success: false, error: expect.stringContaining('managed externally') }),
  )

  const globalDispose = await request.post('/global/dispose')
  expect(globalDispose.status()).toBe(200)
  expect(await globalDispose.json()).toBe(true)

  const instanceDispose = await request.post(`/instance/dispose?directory=${encodeURIComponent(workspaceRoot)}`)
  expect(instanceDispose.status()).toBe(200)
  expect(await instanceDispose.json()).toBe(true)

  const events = await request.get('/event?after=0&live=false')
  expect(events.status()).toBe(200)
  expect(events.headers()['content-type']).toContain('text/event-stream')
})


test('serves OpenCode project mutation routes over HTTP', async ({ request }) => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'specter-code-project-http-'))
  try {
    const projectPath = `/project/${encodeURIComponent(workspaceRoot)}?directory=${encodeURIComponent(workspaceRoot)}`
    const update = await request.patch(projectPath, {
      data: {
        name: 'HTTP Project',
        icon: '🛰️',
        commands: { test: 'pnpm test' },
      },
    })

    expect(update.status()).toBe(200)
    expect(update.headers()['content-type']).toContain('application/json')
    expect(await update.json()).toEqual(
      expect.objectContaining({
        id: workspaceRoot,
        directory: workspaceRoot,
        name: 'HTTP Project',
        icon: '🛰️',
        commands: { test: 'pnpm test' },
      }),
    )
    await expect(
      readFile(path.join(workspaceRoot, '.opencode', 'opencode.jsonc'), 'utf8').then(JSON.parse),
    ).resolves.toEqual(
      expect.objectContaining({
        project: {
          name: 'HTTP Project',
          icon: '🛰️',
          commands: { test: 'pnpm test' },
        },
      }),
    )

    const initGit = await request.post(
      `/project/git/init?directory=${encodeURIComponent(workspaceRoot)}`,
    )
    expect(initGit.status()).toBe(200)
    expect(initGit.headers()['content-type']).toContain('application/json')
    expect(await initGit.json()).toEqual(
      expect.objectContaining({
        id: workspaceRoot,
        directory: workspaceRoot,
        name: 'HTTP Project',
        vcs: 'git',
        worktree: workspaceRoot,
      }),
    )
    await expect(access(path.join(workspaceRoot, '.git'))).resolves.toBeUndefined()
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})


test('serves deprecated OpenCode session permission responses over HTTP', async ({ request }) => {
  const suffix = Math.random().toString(36).slice(2)
  const response = await request.post(
    `/session/session-permission-api-${suffix}/permissions/permission-api-${suffix}`,
    { data: { response: 'once' } },
  )

  expect(response.status()).toBe(200)
  expect(response.headers()['content-type']).toContain('application/json')
  expect(await response.json()).toBe(true)
})

test('serves OpenCode-compatible session message detail and mutation routes over HTTP', async ({ request }) => {
  const suffix = Math.random().toString(36).slice(2)
  const sessionId = `session-message-api-${suffix}`
  const messageId = `message-api-${suffix}`
  const workspaceId = `workspace-api-${suffix}`
  const directory = process.cwd()

  const session = await request.post('/session', {
    data: {
      sessionId,
      workspaceId,
      title: 'Message API smoke',
      directory,
      agent: 'build',
      model: { providerId: 'openrouter', modelId: 'test-model' },
    },
  })
  expect(session.status()).toBe(200)

  const message = await request.post(`/session/${sessionId}/message`, {
    data: {
      messageID: messageId,
      parts: [{ type: 'text', text: 'original message' }],
      noReply: true,
    },
  })
  expect(message.status()).toBe(200)

  const detail = await request.get(`/session/${sessionId}/message/${messageId}`)
  expect(detail.status()).toBe(200)
  expect(detail.headers()['content-type']).toContain('application/json')
  expect(await detail.json()).toEqual({
    info: { id: messageId, sessionID: sessionId, role: 'user' },
    parts: [{ id: 'part_text', type: 'text', text: 'original message' }],
  })

  const context = await request.get(`/api/session/${sessionId}/context`)
  expect(context.status()).toBe(200)
  expect(context.headers()['content-type']).toContain('application/json')
  expect(await context.json()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: messageId, sessionId, role: 'user', content: 'original message' }),
    ]),
  )

  const patched = await request.patch(`/session/${sessionId}/message/${messageId}/part/part_text`, {
    data: { text: 'updated message' },
  })
  expect(patched.status()).toBe(200)
  expect(await patched.json()).toEqual({
    info: { id: messageId, sessionID: sessionId, role: 'user' },
    parts: [{ id: 'part_text', type: 'text', text: 'updated message' }],
  })

  const deletedPart = await request.delete(`/session/${sessionId}/message/${messageId}/part/part_text`)
  expect(deletedPart.status()).toBe(200)
  expect(await deletedPart.json()).toEqual({
    info: { id: messageId, sessionID: sessionId, role: 'user' },
    parts: [],
  })

  const deletedMessage = await request.delete(`/session/${sessionId}/message/${messageId}`)
  expect(deletedMessage.status()).toBe(200)
  expect(await deletedMessage.json()).toBe(true)

  const missingDetail = await request.get(`/session/${sessionId}/message/${messageId}`)
  expect(missingDetail.status()).toBe(400)
})


test('serves OpenCode-compatible session lifecycle and status routes over HTTP', async ({ request }) => {
  const suffix = Math.random().toString(36).slice(2)
  const sessionId = `session-lifecycle-api-${suffix}`
  const forkedSessionId = `session-lifecycle-fork-${suffix}`
  const workspaceId = `workspace-lifecycle-api-${suffix}`
  const directory = process.cwd()

  const initialStatus = await request.get('/session/status')
  expect(initialStatus.status()).toBe(200)
  expect(initialStatus.headers()['content-type']).toContain('application/json')
  expect(await initialStatus.json()).toEqual(expect.any(Object))

  const created = await request.post('/session', {
    data: {
      sessionId,
      workspaceId,
      title: 'Lifecycle API smoke',
      directory,
      agent: 'build',
      model: { providerId: 'openrouter', modelId: 'test-model' },
    },
  })
  expect(created.status()).toBe(200)

  const detail = await request.get(`/session/${sessionId}`)
  expect(detail.status()).toBe(200)
  expect(detail.headers()['content-type']).toContain('application/json')
  expect(await detail.json()).toEqual(
    expect.objectContaining({ id: sessionId, title: 'Lifecycle API smoke', workspaceId }),
  )

  const updated = await request.patch(`/session/${sessionId}`, {
    data: { title: 'Lifecycle API updated' },
  })
  expect(updated.status()).toBe(200)
  expect(await updated.json()).toEqual(
    expect.objectContaining({ id: sessionId, title: 'Lifecycle API updated' }),
  )

  const shared = await request.post(`/session/${sessionId}/share`)
  expect(shared.status()).toBe(200)
  expect(shared.headers()['content-type']).toContain('application/json')
  expect(await shared.json()).toEqual(
    expect.objectContaining({
      id: sessionId,
      share: { url: expect.stringContaining(encodeURIComponent(sessionId)) },
    }),
  )

  const unshared = await request.delete(`/session/${sessionId}/share`)
  expect(unshared.status()).toBe(200)
  expect(await unshared.json()).toEqual(
    expect.objectContaining({ id: sessionId, title: 'Lifecycle API updated' }),
  )

  const unreverted = await request.post(`/session/${sessionId}/unrevert`)
  expect(unreverted.status()).toBe(200)
  expect(await unreverted.json()).toEqual(
    expect.objectContaining({ id: sessionId, title: 'Lifecycle API updated', reverted: false }),
  )

  const forked = await request.post(`/session/${sessionId}/fork`, {
    data: { sessionId: forkedSessionId, title: 'Lifecycle API fork' },
  })
  expect(forked.status()).toBe(200)
  expect(await forked.json()).toEqual(
    expect.objectContaining({ id: forkedSessionId, title: 'Lifecycle API fork' }),
  )

  const children = await request.get(`/session/${sessionId}/children`)
  expect(children.status()).toBe(200)
  expect(await children.json()).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: forkedSessionId })]),
  )

  const abort = await request.post(`/session/${sessionId}/abort`)
  expect(abort.status()).toBe(200)
  expect(await abort.json()).toBe(true)

  const statusAfterAbort = await request.get('/session/status')
  expect(statusAfterAbort.status()).toBe(200)
  expect(await statusAfterAbort.json()).toEqual(
    expect.objectContaining({
      [sessionId]: expect.objectContaining({ sessionId, status: 'aborted' }),
    }),
  )

  const deleted = await request.delete(`/session/${forkedSessionId}`)
  expect(deleted.status()).toBe(200)
  expect(await deleted.json()).toBe(true)
})


test('serves OpenCode-compatible /api aliases and raw diff endpoints over HTTP', async ({ request }) => {
  const workspaceRoot = process.cwd()

  const apiProviders = await request.get('/api/provider')
  expect(apiProviders.status()).toBe(200)
  expect(apiProviders.headers()['content-type']).toContain('application/json')
  expect(await apiProviders.json()).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: 'openrouter' })]),
  )

  const apiModels = await request.get('/api/model')
  expect(apiModels.status()).toBe(200)
  expect(apiModels.headers()['content-type']).toContain('application/json')
  expect(await apiModels.json()).toEqual(expect.any(Array))

  const configProviders = await request.get(`/config/providers?directory=${encodeURIComponent(workspaceRoot)}`)
  expect(configProviders.status()).toBe(200)
  expect(configProviders.headers()['content-type']).toContain('application/json')
  expect(await configProviders.json()).toEqual(expect.any(Array))

  const currentProject = await request.get(`/project/current?directory=${encodeURIComponent(workspaceRoot)}`)
  expect(currentProject.status()).toBe(200)
  expect(currentProject.headers()['content-type']).toContain('application/json')
  expect(await currentProject.json()).toEqual(
    expect.objectContaining({ directory: workspaceRoot, name: path.basename(workspaceRoot) }),
  )

  const resolvedPath = await request.get(`/path?directory=${encodeURIComponent(workspaceRoot)}`)
  expect(resolvedPath.status()).toBe(200)
  expect(resolvedPath.headers()['content-type']).toContain('application/json')
  expect(await resolvedPath.json()).toEqual({ path: workspaceRoot, directory: workspaceRoot })

  const health = await request.get('/global/health')
  expect(health.status()).toBe(200)
  expect(health.headers()['content-type']).toContain('application/json')
  expect(await health.json()).toEqual({ ok: true })

  const providerDetail = await request.get('/api/provider/openrouter')
  expect(providerDetail.status()).toBe(200)
  expect(providerDetail.headers()['content-type']).toContain('application/json')
  expect(await providerDetail.json()).toEqual(expect.objectContaining({ id: 'openrouter' }))

  const globalConfig = await request.get(`/global/config?directory=${encodeURIComponent(workspaceRoot)}`)
  expect(globalConfig.status()).toBe(200)
  expect(globalConfig.headers()['content-type']).toContain('application/json')
  expect(await globalConfig.json()).toEqual(expect.objectContaining({ raw: expect.any(Object) }))

  const globalEvent = await request.get('/global/event?after=0&live=false')
  expect(globalEvent.status()).toBe(200)
  expect(globalEvent.headers()['content-type']).toContain('text/event-stream')

  const rawDiff = await request.get(`/vcs/diff/raw?workspaceRoot=${encodeURIComponent(workspaceRoot)}`)
  expect(rawDiff.status()).toBe(200)
  expect(rawDiff.headers()['content-type']).toContain('text/plain')
  await expect(rawDiff.text()).resolves.toEqual(expect.any(String))
})


test('serves OpenCode-compatible command routes over HTTP', async ({ request }) => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'specter-command-api-'))
  try {
    await mkdir(path.join(workspaceRoot, '.opencode', 'commands'), { recursive: true })
    await writeFile(
      path.join(workspaceRoot, '.opencode', 'commands', 'fix.md'),
      [
        '---',
        'description: Fix a target file',
        'agent: build',
        '---',
        'Fix $1 using $ARGUMENTS',
      ].join('\n'),
    )

    const commands = await request.get(`/command?directory=${encodeURIComponent(workspaceRoot)}`)
    expect(commands.status()).toBe(200)
    expect(commands.headers()['content-type']).toContain('application/json')
    expect(await commands.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'fix',
          description: 'Fix a target file',
          source: 'command',
          hints: ['$1', '$ARGUMENTS'],
        }),
      ]),
    )

    const missingCommand = await request.post(
      `/session/session-api-smoke/command?directory=${encodeURIComponent(workspaceRoot)}`,
      { data: { command: 'missing' } },
    )
    expect(missingCommand.status()).toBe(400)
    expect(missingCommand.headers()['content-type']).toContain('application/json')
    expect(await missingCommand.json()).toEqual({ error: 'Unknown command: missing' })
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})


test('serves OpenCode-compatible session diff and revert routes over HTTP', async ({ request }) => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'specter-session-vcs-'))
  try {
    await execFileAsync('git', ['init'], { cwd: workspaceRoot })
    await writeFile(path.join(workspaceRoot, 'note.txt'), 'original\n')
    await execFileAsync('git', ['add', 'note.txt'], { cwd: workspaceRoot })
    await execFileAsync(
      'git',
      [
        '-c',
        'user.email=specter@example.test',
        '-c',
        'user.name=Specter Test',
        'commit',
        '-m',
        'initial',
      ],
      { cwd: workspaceRoot },
    )

    await writeFile(path.join(workspaceRoot, 'note.txt'), 'changed\n')

    const sessionDiff = await request.get(
      `/session/session-api-smoke/diff?workspaceRoot=${encodeURIComponent(workspaceRoot)}&path=note.txt`,
    )
    expect(sessionDiff.status()).toBe(200)
    expect(sessionDiff.headers()['content-type']).toContain('application/json')
    expect(await sessionDiff.json()).toEqual(
      expect.objectContaining({
        path: 'note.txt',
        staged: false,
        patch: expect.stringContaining('+changed'),
      }),
    )

    const sessionRevert = await request.post('/session/session-api-smoke/revert', {
      data: { workspaceRoot, paths: ['note.txt'] },
    })
    expect(sessionRevert.status()).toBe(200)
    expect(sessionRevert.headers()['content-type']).toContain('application/json')
    expect(await sessionRevert.json()).toEqual({ paths: ['note.txt'] })
    await expect(readFile(path.join(workspaceRoot, 'note.txt'), 'utf8')).resolves.toBe('original\n')
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})


test('serves OpenCode-compatible project, formatter, and config update routes over HTTP', async ({ request }) => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'specter-config-api-'))
  try {
    await mkdir(path.join(workspaceRoot, '.opencode'), { recursive: true })
    await writeFile(
      path.join(workspaceRoot, '.opencode', 'opencode.jsonc'),
      JSON.stringify(
        {
          formatter: {
            prettier: { command: 'pnpm prettier --check .' },
          },
        },
        null,
        2,
      ),
    )

    const projects = await request.get(`/project?directory=${encodeURIComponent(workspaceRoot)}`)
    expect(projects.status()).toBe(200)
    expect(projects.headers()['content-type']).toContain('application/json')
    expect(await projects.json()).toEqual([
      expect.objectContaining({
        id: workspaceRoot,
        directory: workspaceRoot,
        name: path.basename(workspaceRoot),
      }),
    ])

    const formatter = await request.get(`/formatter?directory=${encodeURIComponent(workspaceRoot)}`)
    expect(formatter.status()).toBe(200)
    expect(formatter.headers()['content-type']).toContain('application/json')
    expect(await formatter.json()).toEqual([
      expect.objectContaining({
        name: 'prettier',
        command: 'pnpm prettier --check .',
        enabled: true,
      }),
    ])

    const updatedConfig = await request.patch(`/config?directory=${encodeURIComponent(workspaceRoot)}`, {
      data: { model: 'openrouter/test-model', default_agent: 'build' },
    })
    expect(updatedConfig.status()).toBe(200)
    expect(updatedConfig.headers()['content-type']).toContain('application/json')
    expect(await updatedConfig.json()).toEqual(
      expect.objectContaining({
        model: { providerId: 'openrouter', modelId: 'test-model' },
        defaultAgent: 'build',
        raw: expect.objectContaining({
          model: 'openrouter/test-model',
          default_agent: 'build',
        }),
      }),
    )

    await expect(readFile(path.join(workspaceRoot, '.opencode', 'opencode.jsonc'), 'utf8')).resolves.toContain(
      'openrouter/test-model',
    )
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})


test('serves OpenCode-compatible TUI event routes over HTTP', async ({ request }) => {
  const workspaceRoot = process.cwd()

  const appendPrompt = await request.post(
    `/tui/append-prompt?directory=${encodeURIComponent(workspaceRoot)}`,
    { data: { text: 'hello from HTTP' } },
  )
  expect(appendPrompt.status()).toBe(200)
  expect(appendPrompt.headers()['content-type']).toContain('application/json')
  await expect(appendPrompt.json()).resolves.toBe(true)

  const openHelp = await request.post(`/tui/open-help?directory=${encodeURIComponent(workspaceRoot)}`)
  expect(openHelp.status()).toBe(200)
  await expect(openHelp.json()).resolves.toBe(true)

  const publishToast = await request.post(
    `/tui/publish?directory=${encodeURIComponent(workspaceRoot)}`,
    {
      data: {
        type: 'tui.toast.show',
        properties: { message: 'Saved', variant: 'success' },
      },
    },
  )
  expect(publishToast.status()).toBe(200)
  await expect(publishToast.json()).resolves.toBe(true)
})

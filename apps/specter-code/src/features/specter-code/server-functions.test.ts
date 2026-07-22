import { createClient } from '@libsql/client/sqlite3'
import { createSpecterApp, EventLog } from '@specter-ts/core'
import { createImmediateReactionSchedulerLayer } from '@specter-ts/memory'
import { mkdtempSync, rmSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, expect, test } from 'vitest'
import { Layer } from 'effect'

import { sqliteScenario } from '../../db/scenario-tests'
import {
  createSpecterCodeEventLogService,
  prepareSpecterSqlite,
} from '../../db/specter-sqlite'

const serverDbDir = mkdtempSync(join(tmpdir(), 'specter-code-server-'))
process.env.SPECTER_CODE_DB_PATH = join(serverDbDir, 'app.db')

const {
  askSpecterCodeQuestionOnServer,
  createSpecterCodePostOnServer,
  createSpecterCodeSessionOnServer,
  createSpecterCodeWorkspaceOnServer,
  getSpecterCodeFilesystemStatusOnServer,
  listSpecterCodeAgentRunTimelineOnServer,
  listSpecterCodeFilesystemTreeOnServer,
  listSpecterCodePendingQuestionsOnServer,
  listSpecterCodeSessionTranscriptOnServer,
  listSpecterCodeSessionTodosOnServer,
  listSpecterCodeSessionsOnServer,
  listSpecterCodeWorkspaceAgentRunsOnServer,
  listSpecterCodeWorkspaceChatOnServer,
  listSpecterCodeWorkspacesOnServer,
  readSpecterCodeWorkspaceTextFileOnServer,
  replySpecterCodeQuestionOnServer,
  replyToSpecterCodePostOnServer,
  requestSpecterCodeAgentRunOnServer,
  requestSpecterCodeFilesystemScanOnServer,
  submitSpecterCodePromptOnServer,
  updateSpecterCodeTodoListOnServer,
} = await import('./server-runtime.server')
import { specterCodeReferenceSpecterAppConfig } from './registry'
import {
  resetMemorySliceStores,
  specterCodeMemoryStoresLayer,
} from '../../testing/memory-slice-store'
import { projectSpecterCodeEvent } from './adapters/read-models'

afterAll(() => rmSync(serverDbDir, { recursive: true, force: true }))

test('specterCode server functions wrap workspace, chat, scan, and run slices', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'specter-code-workspaces-'))
  process.env.SPECTER_CODE_WORKSPACE_ROOT = tempDir
  await mkdir(join(tempDir, 'workspace-main', 'src'), { recursive: true })
  await writeFile(
    join(tempDir, 'workspace-main', 'src', 'index.ts'),
    'export const value = 1\n',
  )

  await sqliteScenario(async () => {
    expect(await listSpecterCodeWorkspacesOnServer()).toEqual([])

    await createSpecterCodeWorkspaceOnServer({
      workspaceId: 'workspace-main',
      scanId: 'scan-initial',
      name: '  Design Lab  ',
    })
    expect(await listSpecterCodeWorkspacesOnServer()).toEqual([
      expect.objectContaining({ name: 'Design Lab' }),
    ])

    await createSpecterCodePostOnServer({
      workspaceId: 'workspace-main',
      postId: 'post-main',
      author: { displayName: 'Ada Lovelace' },
      content: 'Can Specter inspect this?',
    })
    await replyToSpecterCodePostOnServer({
      workspaceId: 'workspace-main',
      replyId: 'reply-main',
      parentPostId: 'post-main',
      author: { displayName: 'Grace Hopper' },
      content: 'Please check src/index.ts',
    })

    expect(
      await listSpecterCodeWorkspaceChatOnServer({
        workspaceId: 'workspace-main',
      }),
    ).toHaveLength(2)

    await requestSpecterCodeFilesystemScanOnServer({
      workspaceId: 'workspace-main',
      scanId: 'scan-user',
      reason: 'userRequested',
      requestedBy: { type: 'user', displayName: 'Ada Lovelace' },
    })

    expect(
      await getSpecterCodeFilesystemStatusOnServer({
        workspaceId: 'workspace-main',
      }),
    ).toMatchObject({ initialized: true, latestScan: expect.any(Object) })
    expect(
      await listSpecterCodeFilesystemTreeOnServer({
        workspaceId: 'workspace-main',
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'src' }),
        expect.objectContaining({ path: 'src/index.ts' }),
      ]),
    )

    await requestSpecterCodeAgentRunOnServer({
      workspaceId: 'workspace-main',
      runId: 'run-main',
      postId: 'post-main',
      agentId: 'specter',
      agentName: 'Specter',
      requestedBy: { type: 'user', displayName: 'Ada Lovelace' },
    })

    const runs = await listSpecterCodeWorkspaceAgentRunsOnServer({
      workspaceId: 'workspace-main',
    })
    expect(runs).toEqual(
      expect.arrayContaining([expect.objectContaining({ agentId: 'specter' })]),
    )

    const runId = runs[0]?.runId
    expect(runId).toBeTruthy()
    expect(
      await listSpecterCodeAgentRunTimelineOnServer({
        workspaceId: 'workspace-main',
        runId,
      }),
    ).toBeDefined()

    expect(
      await listSpecterCodeWorkspaceChatOnServer({
        workspaceId: 'workspace-main',
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          author: { type: 'agent', agentId: 'specter', displayName: 'Specter' },
          content: 'I found the issue.',
          parentPostId: 'post-main',
          sourceRunId: runId,
        }),
      ]),
    )

    expect(
      await readSpecterCodeWorkspaceTextFileOnServer({
        workspaceId: 'workspace-main',
        path: 'src/index.ts',
      }),
    ).toContain('export const value = 1')

    await expect(
      readSpecterCodeWorkspaceTextFileOnServer({
        workspaceId: 'workspace-main',
        path: '../escape.txt',
      }),
    ).rejects.toThrow('File path must be relative and normalized')
  })

  rmSync(tempDir, { recursive: true, force: true })
})

test('specterCode server functions wrap sessions, prompts, and transcripts', async () => {
  await sqliteScenario(async () => {
    await createSpecterCodeSessionOnServer({
      sessionId: 'session-main',
      workspaceId: 'workspace-main',
      title: '  Fix failing tests  ',
      directory: '/tmp/project',
      agent: 'build',
      model: { providerId: 'openrouter', modelId: 'anthropic/claude-sonnet-4' },
      createdBy: { userId: 'user-1', displayName: 'Ada Lovelace' },
    })

    expect(
      await listSpecterCodeSessionsOnServer({ workspaceId: 'workspace-main' }),
    ).toEqual([
      expect.objectContaining({
        id: 'session-main',
        title: 'Fix failing tests',
        directory: '/tmp/project',
        agent: 'build',
        model: {
          providerId: 'openrouter',
          modelId: 'anthropic/claude-sonnet-4',
        },
      }),
    ])

    await submitSpecterCodePromptOnServer({
      messageId: 'message-1',
      runId: 'run-1',
      sessionId: 'session-main',
      workspaceId: 'workspace-main',
      content: '  add a regression test  ',
      agentId: 'build',
      agentName: 'Build Agent',
      submittedBy: { userId: 'user-1', displayName: 'Ada Lovelace' },
    })

    expect(
      await listSpecterCodeSessionTranscriptOnServer({
        sessionId: 'session-main',
      }),
    ).toEqual([
      expect.objectContaining({
        id: 'message-1',
        role: 'user',
        content: 'add a regression test',
        author: { userId: 'user-1', displayName: 'Ada Lovelace' },
      }),
    ])

    await updateSpecterCodeTodoListOnServer({
      sessionId: 'session-main',
      messageId: 'message-1',
      items: [
        {
          id: 'todo-1',
          content: ' Add failing test ',
          status: 'completed',
          priority: 'high',
        },
        { id: 'todo-2', content: 'Implement fix', status: 'in_progress' },
      ],
    })

    expect(
      await listSpecterCodeSessionTodosOnServer({ sessionId: 'session-main' }),
    ).toEqual([
      {
        id: 'todo-1',
        content: 'Add failing test',
        status: 'completed',
        priority: 'high',
      },
      { id: 'todo-2', content: 'Implement fix', status: 'in_progress' },
    ])

    await askSpecterCodeQuestionOnServer({
      questionId: 'question-1',
      sessionId: 'session-main',
      messageId: 'message-1',
      prompt: ' Which migration should I run? ',
      options: [{ id: 'safe', label: ' Safe migration ' }],
      allowFreeform: true,
    })

    await askSpecterCodeQuestionOnServer({
      questionId: 'question-other',
      sessionId: 'session-other',
      messageId: 'message-other',
      prompt: ' Run lint too? ',
      options: [],
      allowFreeform: false,
    })

    expect(await listSpecterCodePendingQuestionsOnServer({})).toEqual([
      {
        questionId: 'question-1',
        sessionId: 'session-main',
        messageId: 'message-1',
        prompt: 'Which migration should I run?',
        options: [{ id: 'safe', label: 'Safe migration' }],
        allowFreeform: true,
      },
      {
        questionId: 'question-other',
        sessionId: 'session-other',
        messageId: 'message-other',
        prompt: 'Run lint too?',
        options: [],
        allowFreeform: false,
      },
    ])

    expect(
      await listSpecterCodePendingQuestionsOnServer({
        sessionId: 'session-main',
      }),
    ).toEqual([
      {
        questionId: 'question-1',
        sessionId: 'session-main',
        messageId: 'message-1',
        prompt: 'Which migration should I run?',
        options: [{ id: 'safe', label: 'Safe migration' }],
        allowFreeform: true,
      },
    ])

    await replySpecterCodeQuestionOnServer({
      questionId: 'question-1',
      sessionId: 'session-main',
      answer: 'Use the safe migration',
      answeredBy: { userId: 'user-1', displayName: 'Ada Lovelace' },
    })

    expect(
      await listSpecterCodePendingQuestionsOnServer({
        sessionId: 'session-main',
      }),
    ).toEqual([])
    expect(await listSpecterCodePendingQuestionsOnServer({})).toEqual([
      {
        questionId: 'question-other',
        sessionId: 'session-other',
        messageId: 'message-other',
        prompt: 'Run lint too?',
        options: [],
        allowFreeform: false,
      },
    ])
  })
})

test('specterCode preview reads reject unsafe files and read valid text', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'specterCode-preview-'))
  process.env.SPECTER_CODE_WORKSPACE_ROOT = tempDir

  const workspaceRoot = join(tempDir, 'workspace-main')
  await mkdir(join(workspaceRoot, 'src'), { recursive: true })
  await writeFile(join(workspaceRoot, 'src', 'ok.txt'), 'hello world\n')
  await writeFile(
    join(workspaceRoot, 'src', 'binary.bin'),
    new Uint8Array([0, 159]),
  )
  await writeFile(
    join(workspaceRoot, 'src', 'invalid-utf8.bin'),
    new Uint8Array([0xc3, 0x28]),
  )
  await writeFile(
    join(workspaceRoot, 'src', 'large.txt'),
    'x'.repeat(256 * 1024 + 1),
  )

  await expect(
    readSpecterCodeWorkspaceTextFileOnServer({
      workspaceId: 'workspace-main',
      path: 'src/ok.txt',
    }),
  ).resolves.toBe('hello world\n')

  await expect(
    readSpecterCodeWorkspaceTextFileOnServer({
      workspaceId: 'workspace-main',
      path: 'src/large.txt',
    }),
  ).rejects.toThrow('Preview file exceeds maximum size')

  await expect(
    readSpecterCodeWorkspaceTextFileOnServer({
      workspaceId: 'workspace-main',
      path: 'src/binary.bin',
    }),
  ).rejects.toThrow('Preview file appears to be binary')

  await expect(
    readSpecterCodeWorkspaceTextFileOnServer({
      workspaceId: 'workspace-main',
      path: 'src/invalid-utf8.bin',
    }),
  ).rejects.toThrow('Preview file is not valid UTF-8 text')

  await expect(
    readSpecterCodeWorkspaceTextFileOnServer({
      workspaceId: '../escape-workspace',
      path: 'src/ok.txt',
    }),
  ).rejects.toThrow('Workspace id must be relative and normalized')

  await expect(
    readSpecterCodeWorkspaceTextFileOnServer({
      workspaceId: 'workspace-main',
      path: '../escape.txt',
    }),
  ).rejects.toThrow('File path must be relative and normalized')

  await expect(
    readSpecterCodeWorkspaceTextFileOnServer({
      workspaceId: 'workspace-main',
      path: 'src/missing.txt',
    }),
  ).rejects.toThrow()

  await expect(
    readSpecterCodeWorkspaceTextFileOnServer({
      workspaceId: 'workspace-main',
      path: '.',
    }),
  ).rejects.toThrow('File path must be relative and normalized')

  rmSync(tempDir, { recursive: true, force: true })
})

test('specterCode server functions preserve database state across app reopen', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'specter-code-'))
  const sqlitePath = join(tempDir, 'app.db')

  try {
    const firstSqlite = createClient({ url: `file:${sqlitePath}` })

    try {
      await prepareSpecterSqlite(firstSqlite)
      const eventLog = createSpecterCodeEventLogService(
        firstSqlite,
        projectSpecterCodeEvent,
      )
      const app = await createSpecterApp(
        specterCodeReferenceSpecterAppConfig,
        Layer.mergeAll(
          Layer.succeed(EventLog, eventLog),
          createImmediateReactionSchedulerLayer(),
          specterCodeMemoryStoresLayer(),
        ),
      )
      const execution = await app.command({
        type: 'createWorkspace',
        payload: {
          workspaceId: 'workspace-durable',
          scanId: 'scan-durable',
          name: 'Durable Lab',
        },
      })
      await execution.reactions
      await app.query({ type: 'workspaceList', payload: {} })
    } finally {
      firstSqlite.close()
    }

    resetMemorySliceStores()
    const secondSqlite = createClient({ url: `file:${sqlitePath}` })

    try {
      await prepareSpecterSqlite(secondSqlite)
      const eventLog = createSpecterCodeEventLogService(
        secondSqlite,
        projectSpecterCodeEvent,
      )
      const app = await createSpecterApp(
        specterCodeReferenceSpecterAppConfig,
        Layer.mergeAll(
          Layer.succeed(EventLog, eventLog),
          createImmediateReactionSchedulerLayer(),
          specterCodeMemoryStoresLayer(),
        ),
      )
      expect(await app.query({ type: 'workspaceList', payload: {} })).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: expect.any(String) }),
        ]),
      )
    } finally {
      secondSqlite.close()
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

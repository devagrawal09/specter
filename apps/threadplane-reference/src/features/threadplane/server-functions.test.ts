import { createClient } from '@libsql/client/sqlite3'
import { createSpecterApp } from '@specter-ts/core'
import { mkdtempSync, rmSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'

import { sqliteScenario } from '../../db/scenario-tests'
import { prepareSpecterSqlite, runWithSqliteDb } from '../../db/specter-sqlite'
import {
  createThreadplanePostOnServer,
  createThreadplaneWorkspaceOnServer,
  getThreadplaneFilesystemStatusOnServer,
  listThreadplaneAgentRunTimelineOnServer,
  listThreadplaneFilesystemTreeOnServer,
  listThreadplaneWorkspaceAgentRunsOnServer,
  listThreadplaneWorkspaceChatOnServer,
  listThreadplaneWorkspacesOnServer,
  readThreadplaneWorkspaceTextFileOnServer,
  replyToThreadplanePostOnServer,
  requestThreadplaneAgentRunOnServer,
  requestThreadplaneFilesystemScanOnServer,
} from './server-runtime.server'
import { threadplaneReferenceSpecterAppConfig } from './registry'

test('threadplane server functions wrap workspace, chat, scan, and run slices', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'threadplane-workspaces-'))
  process.env.THREADPLANE_WORKSPACE_ROOT = tempDir
  await mkdir(join(tempDir, 'workspace-main', 'src'), { recursive: true })
  await writeFile(
    join(tempDir, 'workspace-main', 'src', 'index.ts'),
    'export const value = 1\n',
  )

  await sqliteScenario(async () => {
    expect(await listThreadplaneWorkspacesOnServer()).toEqual([])

    await createThreadplaneWorkspaceOnServer({ name: '  Design Lab  ' })
    expect(await listThreadplaneWorkspacesOnServer()).toEqual([
      expect.objectContaining({ name: 'Design Lab' }),
    ])

    await createThreadplanePostOnServer({
      workspaceId: 'workspace-main',
      author: { displayName: 'Ada Lovelace' },
      content: 'Can Specter inspect this?',
    })
    await replyToThreadplanePostOnServer({
      workspaceId: 'workspace-main',
      parentPostId: 'generated',
      author: { displayName: 'Grace Hopper' },
      content: 'Please check src/index.ts',
    })

    expect(
      await listThreadplaneWorkspaceChatOnServer({
        workspaceId: 'workspace-main',
      }),
    ).toHaveLength(2)

    await requestThreadplaneFilesystemScanOnServer({
      workspaceId: 'workspace-main',
      reason: 'userRequested',
      requestedBy: { type: 'user', displayName: 'Ada Lovelace' },
    })

    expect(
      await getThreadplaneFilesystemStatusOnServer({
        workspaceId: 'workspace-main',
      }),
    ).toMatchObject({ initialized: false, latestScan: expect.any(Object) })
    expect(
      await listThreadplaneFilesystemTreeOnServer({
        workspaceId: 'workspace-main',
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'src' }),
        expect.objectContaining({ path: 'src/index.ts' }),
      ]),
    )

    await requestThreadplaneAgentRunOnServer({
      workspaceId: 'workspace-main',
      postId: 'generated',
      agentId: 'specter',
      agentName: 'Specter',
      requestedBy: { type: 'user', displayName: 'Ada Lovelace' },
    })

    const runs = await listThreadplaneWorkspaceAgentRunsOnServer({
      workspaceId: 'workspace-main',
    })
    expect(runs).toEqual(
      expect.arrayContaining([expect.objectContaining({ agentId: 'specter' })]),
    )

    const runId = runs[0]?.runId
    expect(runId).toBeTruthy()
    expect(
      await listThreadplaneAgentRunTimelineOnServer({
        workspaceId: 'workspace-main',
        runId,
      }),
    ).toBeDefined()

    expect(
      await readThreadplaneWorkspaceTextFileOnServer({
        workspaceId: 'workspace-main',
        path: 'src/index.ts',
      }),
    ).toContain('export const value = 1')

    await expect(
      readThreadplaneWorkspaceTextFileOnServer({
        workspaceId: 'workspace-main',
        path: '../escape.txt',
      }),
    ).rejects.toThrow('File path must be relative and normalized')
  })

  rmSync(tempDir, { recursive: true, force: true })
})

test('threadplane preview reads reject unsafe files and read valid text', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'threadplane-preview-'))
  process.env.THREADPLANE_WORKSPACE_ROOT = tempDir

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
    readThreadplaneWorkspaceTextFileOnServer({
      workspaceId: 'workspace-main',
      path: 'src/ok.txt',
    }),
  ).resolves.toBe('hello world\n')

  await expect(
    readThreadplaneWorkspaceTextFileOnServer({
      workspaceId: 'workspace-main',
      path: 'src/large.txt',
    }),
  ).rejects.toThrow('Preview file exceeds maximum size')

  await expect(
    readThreadplaneWorkspaceTextFileOnServer({
      workspaceId: 'workspace-main',
      path: 'src/binary.bin',
    }),
  ).rejects.toThrow('Preview file appears to be binary')

  await expect(
    readThreadplaneWorkspaceTextFileOnServer({
      workspaceId: 'workspace-main',
      path: 'src/invalid-utf8.bin',
    }),
  ).rejects.toThrow('Preview file is not valid UTF-8 text')

  await expect(
    readThreadplaneWorkspaceTextFileOnServer({
      workspaceId: '../escape-workspace',
      path: 'src/ok.txt',
    }),
  ).rejects.toThrow('Workspace id must be relative and normalized')

  await expect(
    readThreadplaneWorkspaceTextFileOnServer({
      workspaceId: 'workspace-main',
      path: '../escape.txt',
    }),
  ).rejects.toThrow('File path must be relative and normalized')

  await expect(
    readThreadplaneWorkspaceTextFileOnServer({
      workspaceId: 'workspace-main',
      path: 'src/missing.txt',
    }),
  ).rejects.toThrow()

  await expect(
    readThreadplaneWorkspaceTextFileOnServer({
      workspaceId: 'workspace-main',
      path: '.',
    }),
  ).rejects.toThrow('File path must be relative and normalized')

  rmSync(tempDir, { recursive: true, force: true })
})

test('threadplane server functions preserve database state across app reopen', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'threadplane-reference-'))
  const sqlitePath = join(tempDir, 'app.db')

  try {
    const firstSqlite = createClient({ url: `file:${sqlitePath}` })

    try {
      await prepareSpecterSqlite(firstSqlite)
      await runWithSqliteDb(firstSqlite, async () => {
        const app = createSpecterApp(threadplaneReferenceSpecterAppConfig)
        await app.createWorkspace({ name: 'Durable Lab' })
        await app.workspaceList({})
      })
    } finally {
      firstSqlite.close()
    }

    const secondSqlite = createClient({ url: `file:${sqlitePath}` })

    try {
      await prepareSpecterSqlite(secondSqlite)
      await runWithSqliteDb(secondSqlite, async () => {
        expect(await listThreadplaneWorkspacesOnServer()).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ name: expect.any(String) }),
          ]),
        )
      })
    } finally {
      secondSqlite.close()
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

import { createSpecterApp } from '@specter-ts/core'
import { createClient } from '@libsql/client/sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'

import { sqliteScenario } from '../../db/scenario-tests'
import { prepareSpecterSqlite, runWithSqliteDb } from '../../db/specter-sqlite'
import {
  createWorkspaceOnServer,
  listWorkspaceMessagesOnServer,
  listWorkspacesOnServer,
  postChatMessageOnServer,
} from './server-runtime.server'
import { threadplaneReferenceSpecterAppConfig } from './registry'

test('chat server-side functions post and list workspace messages', async () => {
  await sqliteScenario(async () => {
    await postChatMessageOnServer({
      workspaceId: 'workspace-main',
      authorName: 'Ada Lovelace',
      content: 'Can @specter help here?',
    })

    const messages = await listWorkspaceMessagesOnServer({
      workspaceId: 'workspace-main',
    })

    expect(messages).toHaveLength(2)
    expect(messages).toMatchObject([
      {
        workspaceId: 'workspace-main',
        author: { type: 'user', displayName: 'Ada Lovelace' },
        content: 'Can @specter help here?',
      },
      {
        workspaceId: 'workspace-main',
        author: { type: 'agent', displayName: 'Specter', agentId: 'specter' },
        content: 'Specter heard: Can @specter help here?',
      },
    ])
  })
})

test('workspace server-side functions seed, create, trim, and list workspaces', async () => {
  await sqliteScenario(async () => {
    expect(await listWorkspacesOnServer()).toEqual([
      { id: 'workspace-main', name: 'Main Workspace' },
    ])

    const workspaces = await createWorkspaceOnServer({ name: '  Design Lab  ' })

    expect(workspaces).toEqual([
      { id: 'workspace-main', name: 'Main Workspace' },
      expect.objectContaining({ name: 'Design Lab' }),
    ])
  })
})

test('workspace server-side functions reject blank workspace names', async () => {
  await sqliteScenario(async () => {
    await expect(createWorkspaceOnServer({ name: '   ' })).rejects.toThrow(
      'Workspace name is required',
    )
  })
})

test('chat server-side functions keep messages scoped by workspace', async () => {
  await sqliteScenario(async () => {
    await postChatMessageOnServer({
      workspaceId: 'workspace-main',
      authorName: 'Ada Lovelace',
      content: 'Main workspace only',
    })
    await postChatMessageOnServer({
      workspaceId: 'workspace-side',
      authorName: 'Grace Hopper',
      content: 'Side workspace @specter only',
    })

    const mainMessages = await listWorkspaceMessagesOnServer({
      workspaceId: 'workspace-main',
    })
    const sideMessages = await listWorkspaceMessagesOnServer({
      workspaceId: 'workspace-side',
    })

    expect(mainMessages.map((message) => message.content)).toEqual([
      'Main workspace only',
    ])
    expect(sideMessages.map((message) => message.content)).toEqual([
      'Side workspace @specter only',
      'Specter heard: Side workspace @specter only',
    ])
  })
})

test('SQLite event log and slice states survive app and database reopen', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'threadplane-reference-'))
  const sqlitePath = join(tempDir, 'app.db')

  try {
    const firstSqlite = createClient({ url: `file:${sqlitePath}` })

    try {
      await prepareSpecterSqlite(firstSqlite)
      await runWithSqliteDb(firstSqlite, async () => {
        const app = createSpecterApp(threadplaneReferenceSpecterAppConfig)

        await app.createWorkspace({
          workspaceId: 'workspace-durable',
          name: 'Durable Lab',
        })
        await app.postMessage({
          workspaceId: 'workspace-durable',
          authorName: 'Ada Lovelace',
          content: 'Durable @specter message',
        })

        await app.workspacesQuery({})
        await app.chatMessagesQuery({ workspaceId: 'workspace-durable' })
      })
    } finally {
      firstSqlite.close()
    }

    const secondSqlite = createClient({ url: `file:${sqlitePath}` })

    try {
      await prepareSpecterSqlite(secondSqlite)

      const stateRows = await secondSqlite.execute({
        sql: `
          SELECT slice_name
          FROM specter_slice_states
          WHERE slice_name IN (?, ?)
          ORDER BY slice_name ASC
        `,
        args: ['chatMessagesQuery', 'workspacesQuery'],
      })

      expect(stateRows.rows.map((row) => row.slice_name)).toEqual([
        'chatMessagesQuery',
        'workspacesQuery',
      ])

      await runWithSqliteDb(secondSqlite, async () => {
        const app = createSpecterApp(threadplaneReferenceSpecterAppConfig)
        const workspaces = await app.workspacesQuery({})
        const messages = await app.chatMessagesQuery({
          workspaceId: 'workspace-durable',
        })

        expect(workspaces).toEqual([
          { id: 'workspace-durable', name: 'Durable Lab' },
        ])
        expect(messages.map((message) => message.content)).toEqual([
          'Durable @specter message',
          'Specter heard: Durable @specter message',
        ])
      })
    } finally {
      secondSqlite.close()
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

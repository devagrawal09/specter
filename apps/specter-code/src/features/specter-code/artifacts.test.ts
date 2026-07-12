import { createClient } from '@libsql/client/sqlite3'
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { prepareSpecterSqlite, runWithSqliteDb } from '../../db/specter-sqlite'
import {
  createFileArtifactStore,
  listSessionArtifacts,
  readArtifactContent,
  writeToolOutputArtifact,
} from './adapters/artifacts'

let tempDir: string
let artifactRoot: string

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), 'specter-code-artifacts-'))
  artifactRoot = path.join(tempDir, 'artifacts')
  await mkdir(artifactRoot, { recursive: true })
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe('file-backed Specter Code artifacts', () => {
  it('persists oversized tool output as a file artifact with a small inline preview', async () => {
    const db = createClient({ url: `file:${path.join(tempDir, 'specter-code.db')}` })
    const store = createFileArtifactStore({ rootDir: artifactRoot })

    try {
      await prepareSpecterSqlite(db)
      await seedSession(db)

      const result = await runWithSqliteDb(db, () =>
        writeToolOutputArtifact(store, {
          sessionId: 'session-1',
          messageId: 'message-1',
          toolName: 'shell',
          title: 'shell stdout',
          content: 'abcdef',
          maxInlineBytes: 3,
          createdAt: '2026-06-25T12:00:00.000Z',
          eventOrder: 7,
        }),
      )

      expect(result.inlineContent).toBe('abc')
      expect(result.truncated).toBe(true)
      expect(result.artifact).toEqual(
        expect.objectContaining({
          sessionId: 'session-1',
          messageId: 'message-1',
          type: 'tool_output',
          title: 'shell stdout',
          sizeBytes: 6,
          preview: 'abc',
          toolName: 'shell',
          createdAt: '2026-06-25T12:00:00.000Z',
        }),
      )
      expect(result.artifact?.path).toMatch(/^session-1\/artifacts\/artifact-[\w-]+\.txt$/)

      const storedFile = path.join(artifactRoot, result.artifact!.path)
      await expect(stat(storedFile)).resolves.toMatchObject({ size: 6 })
      await expect(readArtifactContent(store, result.artifact!.path)).resolves.toBe('abcdef')

      const artifacts = await runWithSqliteDb(db, () =>
        listSessionArtifacts({ sessionId: 'session-1' }),
      )
      expect(artifacts).toEqual([result.artifact])
    } finally {
      db.close()
    }
  })

  it('returns small tool output inline without creating an artifact row', async () => {
    const db = createClient({ url: `file:${path.join(tempDir, 'small.db')}` })
    const store = createFileArtifactStore({ rootDir: artifactRoot })

    try {
      await prepareSpecterSqlite(db)
      await seedSession(db)

      const result = await runWithSqliteDb(db, () =>
        writeToolOutputArtifact(store, {
          sessionId: 'session-1',
          messageId: 'message-1',
          toolName: 'read',
          title: 'read output',
          content: 'ok',
          maxInlineBytes: 10,
          createdAt: '2026-06-25T12:05:00.000Z',
          eventOrder: 8,
        }),
      )

      expect(result).toEqual({
        inlineContent: 'ok',
        truncated: false,
        artifact: undefined,
      })

      const artifacts = await runWithSqliteDb(db, () =>
        listSessionArtifacts({ sessionId: 'session-1' }),
      )
      expect(artifacts).toEqual([])
    } finally {
      db.close()
    }
  })
})

async function seedSession(db: ReturnType<typeof createClient>) {
  await db.execute({
    sql: `
      INSERT INTO specter_code_sessions (
        id,
        workspace_id,
        title,
        directory,
        agent_id,
        provider_id,
        model_id,
        status,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      'session-1',
      'workspace-1',
      'Session',
      tempDir,
      'build',
      'openrouter',
      'test/model',
      'active',
      '2026-06-25T12:00:00.000Z',
      '2026-06-25T12:00:00.000Z',
    ],
  })
  await db.execute({
    sql: `
      INSERT INTO specter_code_messages (
        id,
        session_id,
        role,
        author_json,
        content,
        created_at,
        event_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      'message-1',
      'session-1',
      'assistant',
      '{"displayName":"Specter"}',
      '',
      '2026-06-25T12:00:00.000Z',
      6,
    ],
  })
}

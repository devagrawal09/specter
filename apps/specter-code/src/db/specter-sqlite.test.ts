import { createClient } from '@libsql/client/sqlite3'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { prepareSpecterSqlite } from './specter-sqlite'

const readModelTables = [
  'specter_code_sessions',
  'specter_code_messages',
  'specter_code_message_parts',
  'specter_code_tool_calls',
  'specter_code_permissions',
  'specter_code_todos',
  'specter_code_snapshots',
  'specter_code_artifacts',
  'specter_code_pty_sessions',
] as const

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'specter-code-sqlite-'))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe('prepareSpecterSqlite', () => {
  it('creates dedicated OpenCode-compatible read model tables for durable sessions and tool state', async () => {
    const db = createClient({ url: `file:${join(tempDir, 'specter-code.db')}` })

    try {
      await prepareSpecterSqlite(db)

      const tableResult = await db.execute({
        sql: `
          SELECT name
          FROM sqlite_master
          WHERE type = 'table' AND name LIKE 'specter_code_%'
          ORDER BY name
        `,
        args: [],
      })
      const tableNames = tableResult.rows.map((row) => String(row.name))

      expect(tableNames).toEqual([...readModelTables].sort())

      await expectColumns(db, 'specter_code_sessions', [
        'id',
        'workspace_id',
        'title',
        'directory',
        'agent_id',
        'provider_id',
        'model_id',
        'status',
        'created_at',
        'updated_at',
      ])
      await expectColumns(db, 'specter_code_messages', [
        'id',
        'session_id',
        'role',
        'author_json',
        'content',
        'created_at',
        'event_order',
      ])
      await expectColumns(db, 'specter_code_tool_calls', [
        'id',
        'session_id',
        'message_id',
        'tool_name',
        'status',
        'input_json',
        'output_json',
        'error',
        'started_at',
        'completed_at',
        'event_order',
      ])
      await expectColumns(db, 'specter_code_permissions', [
        'request_id',
        'session_id',
        'message_id',
        'tool_call_id',
        'tool_name',
        'permission',
        'target',
        'action',
        'status',
        'reason',
        'requested_at',
        'replied_at',
        'replied_by_json',
      ])
      await expectColumns(db, 'specter_code_pty_sessions', [
        'id',
        'session_id',
        'cwd',
        'shell',
        'status',
        'started_at',
        'ended_at',
        'last_output_at',
      ])
    } finally {
      db.close()
    }
  })
})

async function expectColumns(
  db: ReturnType<typeof createClient>,
  tableName: string,
  expectedColumns: readonly string[],
) {
  const result = await db.execute({ sql: `PRAGMA table_info(${tableName})`, args: [] })
  const actualColumns = result.rows.map((row) => String(row.name))

  expect(actualColumns).toEqual(expect.arrayContaining([...expectedColumns]))
}

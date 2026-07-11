import { createClient } from '@libsql/client/sqlite3'
import { createSpecterApp } from '@specter-ts/core'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createSqliteReactionScheduler } from './reaction-queue'
import { prepareSpecterSqlite, runWithSqliteDb } from './specter-sqlite'
import { specterCodeReferenceSpecterAppConfig } from '../features/specter-code/registry'

let tempDir: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'specterCode-reaction-queue-'))
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

describe('SQLite reaction queue scheduler', () => {
  it('persists reaction requests and marks the queued job completed after the reaction run drains', async () => {
    const db = createClient({ url: `file:${join(tempDir, 'app.db')}` })
    const run = vi.fn(async () => {})

    try {
      await prepareSpecterSqlite(db)

      await runWithSqliteDb(db, async () => {
        const requestReactions = createSqliteReactionScheduler()(run)
        const waitForIdle = requestReactions()

        await waitForIdle()
      })

      const rows = await db.execute({
        sql: `
          SELECT status, error
          FROM specter_reaction_queue
          ORDER BY requested_at ASC
        `,
        args: [],
      })

      expect(run).toHaveBeenCalledTimes(1)
      expect(rows.rows).toEqual([{ status: 'completed', error: null }])
    } finally {
      db.close()
    }
  })

  it('requeues stale running jobs so a later scheduler instance can resume unfinished reaction work', async () => {
    const db = createClient({ url: `file:${join(tempDir, 'resume.db')}` })
    const run = vi.fn(async () => {})
    const now = new Date('2026-06-25T12:00:00.000Z')

    try {
      await prepareSpecterSqlite(db)
      await db.execute({
        sql: `
          INSERT INTO specter_reaction_queue (
            id,
            status,
            requested_at,
            started_at,
            completed_at,
            error
          ) VALUES (?, 'running', ?, ?, NULL, NULL)
        `,
        args: [
          'stale-job-1',
          '2026-06-25T11:00:00.000Z',
          '2026-06-25T11:00:00.000Z',
        ],
      })

      await runWithSqliteDb(db, async () => {
        const requestReactions = createSqliteReactionScheduler({
          now: () => now,
          staleRunningAfterMs: 30_000,
        })(run)
        const waitForIdle = requestReactions()

        await waitForIdle()
      })

      const rows = await db.execute({
        sql: `
          SELECT id, status, completed_at, error
          FROM specter_reaction_queue
          ORDER BY id ASC
        `,
        args: [],
      })

      expect(run).toHaveBeenCalledTimes(2)
      expect(rows.rows).toHaveLength(2)
      expect(rows.rows).toContainEqual({
        id: 'stale-job-1',
        status: 'completed',
        completed_at: now.toISOString(),
        error: null,
      })
      expect(rows.rows).toContainEqual({
        id: expect.not.stringMatching(/^stale-job-1$/),
        status: 'completed',
        completed_at: now.toISOString(),
        error: null,
      })
    } finally {
      db.close()
    }
  })

  it('wires the Specter Code app registry to the durable SQLite reaction queue', async () => {
    const db = createClient({ url: `file:${join(tempDir, 'registry.db')}` })

    try {
      await prepareSpecterSqlite(db)
      const app = await createSpecterApp(specterCodeReferenceSpecterAppConfig)

      await runWithSqliteDb(db, async () => {
        await app.createWorkspace({
          workspaceId: 'workspace-queue-1',
          scanId: 'scan-queue-1',
          name: 'Durable queue workspace',
        })
      })

      const rows = await db.execute({
        sql: `
          SELECT status
          FROM specter_reaction_queue
          ORDER BY requested_at ASC
        `,
        args: [],
      })

      expect(rows.rows.length).toBeGreaterThan(0)
      expect(rows.rows.every((row) => row.status === 'completed')).toBe(true)
    } finally {
      db.close()
    }
  })

})

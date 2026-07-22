import { createClient } from '@libsql/client/sqlite3'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { sqliteDatabaseSize } from './segment-storage'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('SQLite segment storage accounting', () => {
  it('counts write volume still held in the WAL toward rotation', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'specter-segment-size-'))
    temporaryDirectories.push(directory)
    const path = join(directory, 'collector-20260718120000000.db')
    const client = createClient({ url: `file:${path}` })
    await client.execute('PRAGMA journal_mode = WAL')
    await client.execute('PRAGMA wal_autocheckpoint = 0')
    await client.execute('CREATE TABLE observations (payload TEXT NOT NULL)')
    const payload = 'x'.repeat(16 * 1024)
    await client.batch(
      Array.from({ length: 32 }, () => ({
        sql: 'INSERT INTO observations (payload) VALUES (?)',
        args: [payload],
      })),
      'write',
    )

    const databaseBytes = statSync(path).size
    const walBytes = statSync(`${path}-wal`).size
    const rotationLimit = databaseBytes + Math.floor(walBytes / 2)
    expect(walBytes).toBeGreaterThan(0)
    expect(databaseBytes).toBeLessThan(rotationLimit)
    expect(sqliteDatabaseSize(path)).toBeGreaterThanOrEqual(
      databaseBytes + walBytes,
    )
    expect(sqliteDatabaseSize(path)).toBeGreaterThanOrEqual(rotationLimit)
    client.close()
  })
})

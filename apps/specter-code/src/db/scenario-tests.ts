import { createClient } from '@libsql/client/sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { prepareSpecterSqlite, runWithSqliteDb } from './specter-sqlite'
import { resetMemorySliceStores } from '../testing/memory-slice-store'

export async function sqliteScenario<T>(run: () => Promise<T>) {
  const tempDir = mkdtempSync(join(tmpdir(), 'specterCode-scenario-'))
  const sqlite = createClient({ url: `file:${join(tempDir, 'app.db')}` })

  try {
    resetMemorySliceStores()
    await prepareSpecterSqlite(sqlite)
    return await runWithSqliteDb(sqlite, run)
  } finally {
    resetMemorySliceStores()
    sqlite.close()
    rmSync(tempDir, { recursive: true, force: true })
  }
}

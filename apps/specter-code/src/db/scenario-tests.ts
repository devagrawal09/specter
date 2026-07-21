import { createClient } from '@libsql/client/sqlite3'
import { Effect } from 'effect'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { prepareSpecterSqlite, runWithSqliteDb } from './specter-sqlite'
import { specterCodeMemoryStoresLayer } from '../testing/memory-slice-store'
import { resetMemorySliceStores } from '../testing/memory-slice-store'

export function sqliteScenario<T>(
  program: Effect.Effect<T, unknown, unknown>,
): Promise<T>
export function sqliteScenario<T>(run: () => Promise<T>): Promise<T>
export async function sqliteScenario<T>(
  programOrRun: Effect.Effect<T, unknown, unknown> | (() => Promise<T>),
) {
  const tempDir = mkdtempSync(join(tmpdir(), 'specterCode-scenario-'))
  const sqlite = createClient({ url: `file:${join(tempDir, 'app.db')}` })

  try {
    resetMemorySliceStores()
    await prepareSpecterSqlite(sqlite)
    return await runWithSqliteDb(sqlite, () =>
      typeof programOrRun === 'function'
        ? programOrRun()
        : Effect.runPromise(
            programOrRun.pipe(
              Effect.provide(specterCodeMemoryStoresLayer()),
            ),
          ),
    )
  } finally {
    resetMemorySliceStores()
    sqlite.close()
    rmSync(tempDir, { recursive: true, force: true })
  }
}

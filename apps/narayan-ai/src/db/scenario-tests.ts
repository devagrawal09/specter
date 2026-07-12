import { createClient } from '@libsql/client/sqlite3'
import { drizzle } from 'drizzle-orm/libsql/sqlite3'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import * as schema from './schema'
import { runWithSqliteDb } from './specter-sqlite'

export type SqliteScenarioOptions = {
  migrationsFolder?: string
}

export function sqliteScenario(options: SqliteScenarioOptions = {}) {
  return async <T>(run: () => Promise<T>) => {
    const dir = mkdtempSync(join(tmpdir(), 'narayan-ai-'))
    const sqlite = createClient({ url: `file:${join(dir, 'scenario.db')}` })

    try {
      const db = drizzle(sqlite, { schema })
      await migrate(db, {
        migrationsFolder:
          options.migrationsFolder ?? join(process.cwd(), 'drizzle'),
      })

      return await runWithSqliteDb(db, run)
    } finally {
      sqlite.close()
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

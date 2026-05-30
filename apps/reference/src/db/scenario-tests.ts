import { createClient } from '@libsql/client/sqlite3'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { join } from 'node:path'
import { runWithSqliteDb } from './specter-sqlite'
import * as schema from './schema'

export type SqliteScenarioOptions = {
  migrationsFolder?: string
}

export function sqliteScenario(options: SqliteScenarioOptions) {
  return async <T>(run: () => Promise<T>) => {
    const sqlite = createClient({ url: 'file::memory:' })

    try {
      const db = drizzle(sqlite, { schema })
      await migrate(db, {
        migrationsFolder:
          options.migrationsFolder ?? join(process.cwd(), 'drizzle'),
      })

      return await runWithSqliteDb(db, run)
    } finally {
      sqlite.close()
    }
  }
}

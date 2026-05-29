import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { join } from 'node:path'
import { runWithSqliteDb } from './specter-sqlite'

export type SqliteScenarioOptions = {
  migrationsFolder?: string
}

export function sqliteScenario(options: SqliteScenarioOptions) {
  return async <T>(run: () => Promise<T>) => {
    const sqlite = new Database(':memory:')

    try {
      const db = drizzle(sqlite)
      migrate(db, {
        migrationsFolder:
          options.migrationsFolder ?? join(process.cwd(), 'drizzle'),
      })

      return await runWithSqliteDb(db, run)
    } finally {
      sqlite.close()
    }
  }
}

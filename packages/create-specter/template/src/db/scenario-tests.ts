import { createClient } from '@libsql/client/sqlite3'
import { drizzle } from 'drizzle-orm/libsql/sqlite3'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { join } from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { Effect } from 'effect'
import { createSqliteSliceStoreLayer } from './specter-sqlite'
import * as schema from './schema'

export type SqliteScenarioOptions = {
  migrationsFolder?: string
}

export function sqliteScenario(options: SqliteScenarioOptions) {
  return async <T>(program: Effect.Effect<T, unknown, unknown>) => {
    const directory = mkdtempSync(join(tmpdir(), 'specter-app-'))
    const sqlite = createClient({ url: `file:${join(directory, 'scenario.db')}` })

    try {
      const db = drizzle(sqlite, { schema })
      await migrate(db, {
        migrationsFolder:
          options.migrationsFolder ?? join(process.cwd(), 'drizzle'),
      })

      return await Effect.runPromise(
        program.pipe(
          Effect.provide(createSqliteSliceStoreLayer(db)),
        ) as Effect.Effect<T, unknown, never>,
      )
    } finally {
      sqlite.close()
      rmSync(directory, { recursive: true, force: true })
    }
  }
}

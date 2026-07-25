import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createClient } from '@libsql/client/sqlite3'
import { drizzle } from 'drizzle-orm/libsql/sqlite3'
import { migrate } from 'drizzle-orm/libsql/migrator'
import type { Effect } from 'effect'
import { Effect as EffectRuntime } from 'effect'

import * as schema from './schema'
import { createSqliteSliceStoreLayer } from './specter-sqlite'
import { createSqliteDatabaseContext } from '@specter-ts/sqlite'

export function sqliteScenario() {
  return async <T>(program: Effect.Effect<T, unknown, unknown>) => {
    const directory = mkdtempSync(join(tmpdir(), 'specter-personal-mail-'))
    const sqlite = createClient({
      url: `file:${join(directory, 'scenario.db')}`,
    })
    try {
      await migrate(drizzle(sqlite, { schema }), {
        migrationsFolder: join(process.cwd(), 'drizzle'),
      })
      return await EffectRuntime.runPromise(
        program.pipe(
          EffectRuntime.provide(
            createSqliteSliceStoreLayer(createSqliteDatabaseContext(sqlite)),
          ),
        ) as Effect.Effect<T, unknown, never>,
      )
    } finally {
      sqlite.close()
      rmSync(directory, { recursive: true, force: true })
    }
  }
}

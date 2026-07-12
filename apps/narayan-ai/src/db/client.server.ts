import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

import { createClient } from '@libsql/client/sqlite3'
import { drizzle } from 'drizzle-orm/libsql/sqlite3'

import * as schema from './schema'
import { hasSqliteDbBinding, runWithSqliteDb } from './specter-sqlite'

const sqlitePath = process.env.NARAYAN_AI_DB_PATH ?? './data/narayan-ai.db'

mkdirSync(dirname(sqlitePath), { recursive: true })

const sqlite = createClient({ url: `file:${sqlitePath}` })
export const db = drizzle(sqlite, { schema })

export async function runWithNarayanAiDb<T>(run: () => Promise<T>) {
  if (hasSqliteDbBinding()) return run()
  return runWithSqliteDb(db, run)
}

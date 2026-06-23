import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

import { createClient } from '@libsql/client/sqlite3'

import {
  hasSqliteDbBinding,
  prepareSpecterSqlite,
  runWithSqliteDb,
} from './specter-sqlite'

const sqlitePath =
  process.env.SPECTER_CODE_DB_PATH ?? './data/specter-code.db'
const sqliteUrl = `file:${sqlitePath}`

mkdirSync(dirname(sqlitePath), { recursive: true })

const sqlite = createClient({ url: sqliteUrl })
let prepared: Promise<void> | undefined

export async function runWithSpecterCodeReferenceDb<T>(run: () => Promise<T>) {
  if (hasSqliteDbBinding()) return run()

  prepared ??= prepareSpecterSqlite(sqlite)
  await prepared

  return runWithSqliteDb(sqlite, run)
}

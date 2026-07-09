import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

import { createClient } from '@libsql/client/sqlite3'

import {
  hasSqliteDbBinding,
  prepareSpecterSqlite,
  runWithSqliteDb,
} from './specter-sqlite'

const sqlitePath = './data/threadplane-reference.db'
const sqliteUrl = `file:${sqlitePath}`

mkdirSync(dirname(sqlitePath), { recursive: true })

const sqlite = createClient({ url: sqliteUrl })
let prepared: Promise<void> | undefined

export async function runWithThreadplaneReferenceDb<T>(run: () => Promise<T>) {
  if (hasSqliteDbBinding()) return run()

  prepared ??= prepareSpecterSqlite(sqlite)
  await prepared

  return runWithSqliteDb(sqlite, run)
}

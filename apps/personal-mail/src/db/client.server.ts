import { chmodSync, closeSync, mkdirSync, openSync } from 'node:fs'
import { dirname } from 'node:path'

import { createClient } from '@libsql/client/sqlite3'
import { drizzle } from 'drizzle-orm/libsql/sqlite3'

import * as schema from './schema'

export function openApplicationDatabase(
  sqlitePath = process.env.SPECTER_MAIL_SQLITE_PATH ??
    './data/personal-mail.db',
) {
  const databaseDirectory = dirname(sqlitePath)
  mkdirSync(databaseDirectory, { recursive: true, mode: 0o700 })
  if (databaseDirectory !== '.') chmodSync(databaseDirectory, 0o700)
  closeSync(openSync(sqlitePath, 'a', 0o600))
  chmodSync(sqlitePath, 0o600)
  const client = createClient({ url: `file:${sqlitePath}` })
  const db = drizzle(client, { schema })
  return { client, db, sqlitePath }
}

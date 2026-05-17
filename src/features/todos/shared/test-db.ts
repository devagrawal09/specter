import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { fileURLToPath } from 'node:url'

import * as schema from '../../../db/schema'

const migrationsFolder = fileURLToPath(
  new URL('../../../../drizzle', import.meta.url),
)

export function createTestDb() {
  const sqlite = new Database(':memory:')
  const db = drizzle(sqlite, { schema })

  migrate(db, { migrationsFolder })

  return { db, sqlite }
}

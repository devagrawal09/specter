import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { join } from 'node:path'

import { events, sliceCursors } from '.'
import { createMemoryJsonSliceStorage } from './json-storage'

const schema = { events, sliceCursors }

const migrationsFolder = join(process.cwd(), 'drizzle')

export function createTestDb() {
  const sqlite = new Database(':memory:')
  const db = drizzle(sqlite, { schema })

  migrate(db, { migrationsFolder })

  return { db, sqlite }
}

export function createTestRuntime() {
  const { db, sqlite } = createTestDb()

  return {
    runtime: {
      tx: db,
      jsonStorage: createMemoryJsonSliceStorage(),
    },
    sqlite,
  }
}

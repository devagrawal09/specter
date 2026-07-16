import { createClient } from '@libsql/client/sqlite3'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { drizzle } from 'drizzle-orm/libsql/sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { createSqliteEventLog, prepareSqliteEventLog } from '@specter-ts/sqlite'
import * as schema from './schema'

test('appends multiple events in input order', async () => {
  const { sqlite, tempDir } = await createMigratedDb()

  try {
    await prepareSqliteEventLog(sqlite)
    const eventLog = createSqliteEventLog(sqlite)
    const appended = await eventLog.transaction((transaction) =>
      transaction.append([
        { type: 'event.one', payload: { position: 1 } },
        { type: 'event.two', payload: { position: 2 } },
        { type: 'event.three', payload: { position: 3 } },
      ]),
    )

    expect(appended.events.map((event) => event.type)).toEqual([
      'event.one',
      'event.two',
      'event.three',
    ])
    expect(appended.events.map((event) => event.order)).toEqual([1, 2, 3])
  } finally {
    sqlite.close()
    rmSync(tempDir, { recursive: true, force: true })
  }
})

async function createMigratedDb() {
  const tempDir = mkdtempSync(join(tmpdir(), 'specter-sqlite-'))
  const sqlite = createClient({ url: `file:${join(tempDir, 'app.db')}` })
  const db = drizzle(sqlite, { schema })
  await migrate(db, { migrationsFolder: join(process.cwd(), 'drizzle') })
  return { sqlite, db, tempDir }
}

import { createClient } from '@libsql/client/sqlite3'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { drizzle } from 'drizzle-orm/libsql/sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import * as schema from './schema'
import { runWithSqliteDb, sqliteEventLog } from './specter-sqlite'

test('appends multiple events in input order', async () => {
  const { sqlite, db, tempDir } = await createMigratedDb()

  try {
    const appended = await runWithSqliteDb(db, async () =>
      sqliteEventLog.transaction(async (eventLog) =>
        eventLog.append([
          { type: 'event.one', payload: { position: 1 } },
          { type: 'event.two', payload: { position: 2 } },
          { type: 'event.three', payload: { position: 3 } },
        ]),
      ),
    )

    expect(appended.map((event) => event.type)).toEqual([
      'event.one',
      'event.two',
      'event.three',
    ])
    expect(appended.map((event) => event.order)).toEqual([1, 2, 3])
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

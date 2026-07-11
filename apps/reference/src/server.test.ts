import { createClient } from '@libsql/client/sqlite3'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { drizzle } from 'drizzle-orm/libsql/sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, test } from 'vitest'
import * as schema from './db/schema'

let app: Awaited<typeof import('./server')>['default']
let tempDir: string

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'specter-reference-'))
  const sqlitePath = join(tempDir, 'app.db')
  const sqlite = createClient({ url: `file:${sqlitePath}` })

  try {
    const db = drizzle(sqlite, { schema })
    await migrate(db, { migrationsFolder: join(process.cwd(), 'drizzle') })
  } finally {
    sqlite.close()
  }

  process.env.SPECTER_SQLITE_PATH = sqlitePath
  app = (await import('./server')).default
})

afterAll(() => {
  delete process.env.SPECTER_SQLITE_PATH
  rmSync(tempDir, { recursive: true, force: true })
})

test('handles command followed by immediate query without SQLITE_BUSY', async () => {
  const commandResponse = await postJson('/api/addTodo', {
    todoId: 'todo-1',
    title: 'Ship it',
  })

  expect(commandResponse.status).toBe(200)
  expect(await commandResponse.json()).toBeNull()

  const queryResponse = await postJson('/api/todosQuery', { status: 'all' })
  const queryBody = await queryResponse.json()

  expect(queryResponse.status).toBe(200)
  expect(queryBody).toEqual([
    expect.objectContaining({ title: 'Ship it', completed: false }),
  ])
})

function postJson(path: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

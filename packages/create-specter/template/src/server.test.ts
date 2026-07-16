import { createClient } from '@libsql/client/sqlite3'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { drizzle } from 'drizzle-orm/libsql/sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, test } from 'vitest'
import * as schema from './db/schema'
import type { TodoSpecterAppConfig } from './features/todos/registry'
import { createSpecterBrowserTransport } from './transport/specter-browser'

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
  const commandResponse = await postJson('/api/command', {
    envelope: {
      type: 'addTodo',
      payload: { todoId: 'todo-1', title: 'Ship it' },
    },
  })

  expect(commandResponse.status).toBe(200)
  const command = (await commandResponse.json()) as { reactionId: string }
  expect(command).toEqual(
    expect.objectContaining({
      duplicate: false,
      reactionId: expect.any(String),
      version: 1,
    }),
  )

  const reactionResponse = await app.request(
    `/api/reactions/${command.reactionId}`,
  )
  expect(reactionResponse.status).toBe(204)

  const queryResponse = await postJson('/api/query', {
    envelope: { type: 'todosQuery', payload: { status: 'all' } },
  })
  const queryBody = await queryResponse.json()

  expect(queryResponse.status).toBe(200)
  expect(queryBody).toEqual([
    expect.objectContaining({ title: 'Ship it', completed: false }),
  ])
})

test('streams typed query updates and exposes Reaction completion separately', async () => {
  const transport = createSpecterBrowserTransport<TodoSpecterAppConfig>(
    '/api',
    {
      fetch: ((input, init) =>
        app.request(String(input), init)) as typeof fetch,
      reconnectDelayMs: 1,
    },
  )
  const abortController = new AbortController()
  const iterator = transport
    .subscribe(
      { type: 'todosQuery', payload: { status: 'all' } },
      { signal: abortController.signal },
    )
    [Symbol.asyncIterator]()

  const initial = await iterator.next()
  expect(initial.done).toBe(false)

  const execution = await transport.command({
    type: 'addTodo',
    payload: { todoId: 'todo-streamed', title: 'Stream it' },
  })
  expect(execution.version).toBeGreaterThan(0)
  await execution.reactions

  const updated = await iterator.next()
  expect(updated.value).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: 'todo-streamed', title: 'Stream it' }),
    ]),
  )

  abortController.abort()
  await iterator.return?.()
})

function postJson(path: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

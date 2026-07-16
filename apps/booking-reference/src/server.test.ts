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
  tempDir = mkdtempSync(join(tmpdir(), 'specter-booking-reference-'))
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
  const roomsResponse = await postJson('/api/query', {
    envelope: {
      type: 'roomScheduleQuery',
      payload: { status: 'all' },
    },
  })
  const rooms = (await roomsResponse.json()) as Array<{ roomId: string }>

  expect(roomsResponse.status).toBe(200)
  expect(rooms.length).toBeGreaterThan(0)

  const commandResponse = await postJson('/api/command', {
    envelope: {
      type: 'requestBooking',
      payload: {
        bookingId: crypto.randomUUID(),
        roomId: rooms[0].roomId,
        requesterEmail: 'ada@example.com',
        requesterName: 'Ada',
        purpose: 'Planning',
        startsAt: '2026-06-01T09:00:00.000Z',
        endsAt: '2026-06-01T10:00:00.000Z',
      },
    },
  })

  expect(commandResponse.status).toBe(200)
  const command = (await commandResponse.json()) as { reactionId: string }
  expect(command).toEqual(
    expect.objectContaining({
      duplicate: false,
      reactionId: expect.any(String),
    }),
  )
  expect(
    (await app.request(`/api/reactions/${command.reactionId}`)).status,
  ).toBe(204)

  const queryResponse = await postJson('/api/query', {
    envelope: { type: 'pendingApprovalsQuery', payload: {} },
  })
  const queryBody = await queryResponse.json()

  expect(queryResponse.status).toBe(200)
  expect(queryBody).toEqual([
    expect.objectContaining({ requesterEmail: 'ada@example.com' }),
  ])
})

function postJson(path: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

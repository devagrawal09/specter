import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, test } from 'vitest'

let app: Awaited<typeof import('./server')>['default']
let tempDir: string

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'worklog-'))
  process.env.WORKLOG_SQLITE_PATH = join(tempDir, 'worklog.db')
  app = (await import('./server')).default
})

afterAll(() => {
  delete process.env.WORKLOG_SQLITE_PATH
  rmSync(tempDir, { recursive: true, force: true })
})

test('handles a command followed by timeline and score queries', async () => {
  const at = '2026-07-18T15:00:00.000Z'
  const commandResponse = await postJson('/api/command', {
    envelope: {
      type: 'addJournalEntry',
      payload: {
        journalEntryId: 'journal-1',
        body: 'Building Worklog',
        activityAt: at,
        createdAt: at,
      },
    },
  })
  expect(commandResponse.status).toBe(200)
  expect(await commandResponse.json()).toEqual(
    expect.objectContaining({ duplicate: false, version: 2 }),
  )

  const timelineResponse = await postJson('/api/query', {
    envelope: {
      type: 'timelineQuery',
      payload: { includeArchived: false, limit: 50 },
    },
  })
  expect(timelineResponse.status).toBe(200)
  expect(await timelineResponse.json()).toEqual([
    expect.objectContaining({
      detail: 'Building Worklog',
      eventType: 'journal-entry-added',
    }),
  ])

  const scoreResponse = await postJson('/api/query', {
    envelope: { type: 'scoreQuery', payload: { limit: 50 } },
  })
  expect(scoreResponse.status).toBe(200)
  expect(await scoreResponse.json()).toEqual(
    expect.objectContaining({ total: 1 }),
  )
})

function postJson(path: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

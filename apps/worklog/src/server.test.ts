import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, test } from 'vitest'

import type { WorklogAppConfig } from './features/worklog/registry'
import { createSpecterBrowserTransport } from './transport/specter-browser'
import { executeWorklogCli } from './worklog-cli.server'

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

test('routes CLI commands through the server and updates active subscriptions', async () => {
  const fetchImplementation: typeof globalThis.fetch = async (input, init) =>
    app.fetch(new Request(input, init))
  const transport = createSpecterBrowserTransport<WorklogAppConfig>(
    'http://worklog.test/api',
    { fetch: fetchImplementation },
  )
  const iterator = transport
    .subscribe({
      type: 'tasksQuery',
      payload: { status: 'all', topicId: null },
    })
    [Symbol.asyncIterator]()

  expect((await iterator.next()).value).toEqual([])

  const result = await executeWorklogCli(
    {
      mode: 'command',
      url: 'http://worklog.test/api',
      idempotencyKey: 'cli-live-subscription-test',
      envelope: {
        type: 'addTask',
        payload: {
          taskId: 'cli-task-1',
          title: 'Appears without refresh',
          notes: null,
          dueAt: null,
          createdAt: '2026-07-18T20:30:00.000Z',
        },
      },
    },
    { fetch: fetchImplementation },
  )

  expect(result).toEqual(
    expect.objectContaining({ transport: 'http', duplicate: false }),
  )
  expect((await iterator.next()).value).toEqual([
    expect.objectContaining({
      id: 'cli-task-1',
      title: 'Appears without refresh',
    }),
  ])
  await iterator.return?.()
})

function postJson(path: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

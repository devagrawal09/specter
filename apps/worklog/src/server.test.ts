import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, test } from 'vitest'

import type { WorklogAppConfig } from './features/worklog/registry'
import { createSpecterBrowserTransport } from './transport/specter-browser'
import {
  specterClientHeader,
  specterClientHeaderValue,
} from './transport/specter-protocol'
import { executeWorklogCli } from './worklog-cli.server'

let app: Awaited<typeof import('./server')>['default']
let tempDir: string

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'worklog-'))
  process.env.WORKLOG_SQLITE_PATH = join(tempDir, 'worklog.db')
  app = (await import('./server')).default
})

afterAll(async () => {
  await app.shutdown()
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

  const gardenResponse = await postJson('/api/query', {
    envelope: { type: 'gardenQuery', payload: {} },
  })
  expect(gardenResponse.status).toBe(200)
  expect(await gardenResponse.json()).toEqual({
    totalPoints: 1,
    records: [
      expect.objectContaining({
        id: 'journal-1',
        kind: 'journal',
        label: 'Building Worklog',
        effects: [],
      }),
    ],
    connections: [],
  })
})

test('routes CLI commands through the server and updates active subscriptions', async () => {
  const fetchImplementation: typeof globalThis.fetch = async (input, init) =>
    app.fetch(new Request(input, init))
  const transport = createSpecterBrowserTransport<WorklogAppConfig>(
    'http://localhost/api',
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
      url: 'http://localhost/api',
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

test('requires JSON and the Worklog client header before command dispatch', async () => {
  const envelope = {
    type: 'addTask',
    payload: {
      taskId: 'hostile-task',
      title: 'Must never be committed',
      notes: null,
      dueAt: null,
      createdAt: '2026-07-18T21:00:00.000Z',
    },
  }

  const textPlain = await app.request('/api/command', {
    method: 'POST',
    headers: {
      'content-type': 'text/plain',
      [specterClientHeader]: specterClientHeaderValue,
    },
    body: JSON.stringify({ envelope }),
  })
  expect(textPlain.status).toBe(415)
  expect(await textPlain.json()).toEqual(
    expect.objectContaining({
      error: expect.objectContaining({
        code: 'SPECTER_TRANSPORT_UNSUPPORTED_MEDIA_TYPE',
      }),
    }),
  )

  const missingClientHeader = await app.request('/api/command', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ envelope }),
  })
  expect(missingClientHeader.status).toBe(403)

  const tasks = await postJson('/api/query', {
    envelope: {
      type: 'tasksQuery',
      payload: { status: 'all', topicId: null },
    },
  })
  expect(await tasks.json()).not.toEqual(
    expect.arrayContaining([expect.objectContaining({ id: 'hostile-task' })]),
  )
})

test('accepts a private proxy hostname and HTTPS browser origin', async () => {
  const proxyRequest = await app.fetch(
    new Request('http://worklog.tailnet.example/api/query', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://worklog.tailnet.example',
        [specterClientHeader]: specterClientHeaderValue,
      },
      body: JSON.stringify({
        envelope: { type: 'scoreQuery', payload: { limit: 50 } },
      }),
    }),
  )
  expect(proxyRequest.status).toBe(200)
})

function postJson(path: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost',
      [specterClientHeader]: specterClientHeaderValue,
    },
    body: JSON.stringify(body),
  })
}

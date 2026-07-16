import { createClient } from '@libsql/client'
import {
  SpecterIdempotencyConflictError,
  SpecterVersionConflictError,
} from '@specter-ts/core'
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  createSpecterSqlitePersistence,
  prepareSpecterSqlite,
} from './persistence'
import { createSqliteEventLog } from './event-log'

const clients: ReturnType<typeof createClient>[] = []
const tempDirectories: string[] = []

afterEach(() => {
  for (const client of clients.splice(0)) client.close()
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

async function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'specter-sqlite-'))
  tempDirectories.push(directory)
  const url = `file:${join(directory, 'specter.db')}`
  const client = createClient({ url })
  clients.push(client)
  await prepareSpecterSqlite(client)
  return { client, url, ...createSpecterSqlitePersistence(client) }
}

describe('Specter SQLite persistence', () => {
  it('commits independent Event and Slice cursor writes', async () => {
    const { eventLog, createSliceStore } = await setup()
    const store = createSliceStore(() => ({ count: 0 }))

    await eventLog.transaction(async (transaction) => {
      await store.transaction('counter', async (slice) => {
        slice.write.count += 1
        await slice.setLastAppliedOrder(0)
      })
      await transaction.append(
        [{ type: 'counter-incremented', payload: { amount: 1 } }],
        { expectedVersion: 0 },
      )
    })

    expect(await eventLog.currentVersion()).toBe(1)
    await store.transaction('counter', async (slice) => {
      expect(slice.read).toEqual({ count: 1 })
    })
  })

  it('keeps published Slice State when a concurrent Event causes append conflict', async () => {
    const { eventLog, createSliceStore, url } = await setup()
    const store = createSliceStore(() => ({ count: 0 }))
    const competingClient = createClient({ url })
    clients.push(competingClient)
    const competingEventLog = createSqliteEventLog(competingClient)

    await expect(
      eventLog.transaction(async (transaction) => {
        const slice = await store.get('counter')
        slice.write.count = 9
        await slice.setLastAppliedOrder(1)

        await competingEventLog.append([
          { type: 'competing-event', payload: { source: 'other-process' } },
        ])

        await transaction.append([
          { type: 'counter-incremented', payload: { amount: 9 } },
        ])
      }),
    ).rejects.toBeInstanceOf(SpecterVersionConflictError)

    expect(await eventLog.currentVersion()).toBe(1)
    const slice = await store.get('counter')
    expect(slice.read).toEqual({ count: 9 })
    expect(await slice.lastAppliedOrder()).toBe(1)
  })

  it('allows project-owned SQLite writes during a logical Event Log transaction', async () => {
    const { eventLog, client, url } = await setup()
    const projectClient = createClient({ url })
    clients.push(projectClient)
    await client.execute(
      'CREATE TABLE project_state (id TEXT PRIMARY KEY, value TEXT NOT NULL)',
    )

    await eventLog.transaction(async (transaction) => {
      await projectClient.execute({
        sql: 'INSERT INTO project_state (id, value) VALUES (?, ?)',
        args: ['state-1', 'published'],
      })
      await transaction.append([
        { type: 'project-state-published', payload: { id: 'state-1' } },
      ])
    })

    const state = await client.execute(
      "SELECT id, value FROM project_state WHERE id = 'state-1'",
    )
    expect(state.rows).toEqual([{ id: 'state-1', value: 'published' }])
    expect(await eventLog.currentVersion()).toBe(1)
  })

  it('supports reentrant logical Event Log transactions', async () => {
    const { eventLog } = await setup()

    await eventLog.transaction(async (outer) => {
      await eventLog.transaction(async (inner) => {
        expect(await inner.currentVersion()).toBe(0)
      })
      await outer.append([{ type: 'nested-work-completed', payload: {} }])
    })

    expect(await eventLog.currentVersion()).toBe(1)
  })

  it('queues top-level appends behind an active command callback', async () => {
    const { eventLog } = await setup()
    let enterCommand = () => {}
    const commandEntered = new Promise<void>((resolve) => {
      enterCommand = resolve
    })
    let releaseCommand = () => {}
    const commandGate = new Promise<void>((resolve) => {
      releaseCommand = resolve
    })

    const command = eventLog.transaction(async (transaction) => {
      enterCommand()
      await commandGate
      return transaction.append([{ type: 'command-event', payload: {} }])
    })
    await commandEntered
    const directAppend = eventLog.append([
      { type: 'direct-event', payload: {} },
    ])
    releaseCommand()

    const [commandCommit, directCommit] = await Promise.all([
      command,
      directAppend,
    ])
    expect(commandCommit.events[0]).toMatchObject({
      order: 1,
      type: 'command-event',
    })
    expect(directCommit.events[0]).toMatchObject({
      order: 2,
      type: 'direct-event',
    })
  })

  it('allows an Event append to reuse an existing physical transaction', async () => {
    const { context, eventLog } = await setup()

    await context.transaction(() =>
      eventLog.append([{ type: 'physically-nested-event', payload: {} }]),
    )

    expect(await eventLog.currentVersion()).toBe(1)
  })

  it('persists get-based projection state and cursor in one write', async () => {
    const { createSliceStore } = await setup()
    const store = createSliceStore(() => ({ count: 0 }))
    const abandoned = await store.get('counter')
    abandoned.write.count = 9

    expect((await store.get('counter')).read).toEqual({ count: 0 })

    const completed = await store.get('counter')
    completed.write.count = 3
    await completed.setLastAppliedOrder(2)
    const persisted = await store.get('counter')

    expect(persisted.read).toEqual({ count: 3 })
    expect(await persisted.lastAppliedOrder()).toBe(2)
  })

  it('enforces expected version and durable idempotency receipts', async () => {
    const { eventLog } = await setup()
    const first = await eventLog.append(
      [{ type: 'todo-added', payload: { todoId: 'todo-1' } }],
      {
        expectedVersion: 0,
        idempotencyKey: 'request-1',
        fingerprint: 'fingerprint-1',
      },
    )
    const duplicate = await eventLog.append(
      [{ type: 'ignored', payload: {} }],
      {
        expectedVersion: 0,
        idempotencyKey: 'request-1',
        fingerprint: 'fingerprint-1',
      },
    )

    expect(first.duplicate).toBe(false)
    expect(duplicate).toEqual({ ...first, duplicate: true })
    await expect(
      eventLog.append([{ type: 'other', payload: {} }], {
        idempotencyKey: 'request-1',
        fingerprint: 'fingerprint-2',
      }),
    ).rejects.toBeInstanceOf(SpecterIdempotencyConflictError)
    await expect(
      eventLog.append([{ type: 'other', payload: {} }], {
        expectedVersion: 0,
      }),
    ).rejects.toBeInstanceOf(SpecterVersionConflictError)
    const { duplicate: _duplicate, ...commit } = first
    expect(await eventLog.findCommit('request-1')).toEqual(commit)
  })

  it('serializes concurrent commands so only one matching expected version commits', async () => {
    const { eventLog } = await setup()
    const append = (id: string) =>
      eventLog.append([{ type: 'created', payload: { id } }], {
        expectedVersion: 0,
      })

    const results = await Promise.allSettled([append('one'), append('two')])

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1)
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1)
    expect(await eventLog.currentVersion()).toBe(1)
  })
})

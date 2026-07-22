import { createClient } from '@libsql/client'
import {
  EventLogFailure,
  SpecterIdempotencyConflictError,
  SpecterVersionConflictError,
} from '@specter-ts/core'
import {
  eventLogConformance,
  sliceStoreConformance,
} from '@specter-ts/core/testing'
import { Effect } from 'effect'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  createSpecterSqlitePersistence,
  prepareSpecterSqlite,
} from './persistence'

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
  const client = createClient({ url: `file:${join(directory, 'specter.db')}` })
  clients.push(client)
  await prepareSpecterSqlite(client)
  return createSpecterSqlitePersistence(client)
}

describe('Specter SQLite persistence', () => {
  it('passes native Event Log conformance', async () => {
    const { eventLog } = await setup()
    await Effect.runPromise(eventLogConformance(Effect.succeed(eventLog)))
  })

  it('passes native Slice Store conformance', async () => {
    const { createSliceStoreService } = await setup()
    const store = createSliceStoreService(() => ({ count: 0 }))
    await Effect.runPromise(
      sliceStoreConformance({
        createService: Effect.succeed(store),
        write: async (state, value: number) => {
          state.count = value
        },
        read: async (state) => state.count,
        value: 7,
      }),
    )
  })

  it('rolls back state and cursor when projection transaction fails', async () => {
    const { createSliceStoreService } = await setup()
    const store = createSliceStoreService(() => ({ count: 0 }))
    await Effect.runPromise(
      store.transaction('counter', (write, _read, _cursor, publish) =>
        Effect.gen(function* () {
          write.count = 3
          yield* publish(2)
        }),
      ),
    )
    await Effect.runPromise(
      Effect.result(
        store.transaction('counter', (write, _read, _cursor, publish) =>
          Effect.gen(function* () {
            write.count = 9
            yield* publish(4)
            return yield* Effect.fail('rollback')
          }),
        ),
      ),
    )

    const visible = await Effect.runPromise(
      store.read('counter', (read, cursor) =>
        Effect.succeed({ count: read.count, cursor }),
      ),
    )
    expect(visible).toEqual({ count: 3, cursor: 2 })
  })

  it('returns typed failures for version and idempotency conflicts', async () => {
    const { eventLog } = await setup()
    const first = await Effect.runPromise(
      eventLog.append([{ type: 'todo-added', payload: { todoId: 'todo-1' } }], {
        expectedVersion: 0,
        idempotencyKey: 'request-1',
        fingerprint: 'fingerprint-1',
      }),
    )
    const duplicate = await Effect.runPromise(
      eventLog.append([{ type: 'ignored', payload: {} }], {
        expectedVersion: 0,
        idempotencyKey: 'request-1',
        fingerprint: 'fingerprint-1',
      }),
    )
    expect(duplicate).toEqual({ ...first, duplicate: true })

    const idempotency = await Effect.runPromise(
      Effect.flip(
        eventLog.append([{ type: 'other', payload: {} }], {
          idempotencyKey: 'request-1',
          fingerprint: 'fingerprint-2',
        }),
      ),
    )
    expect(idempotency).toBeInstanceOf(EventLogFailure)
    expect(idempotency.cause).toBeInstanceOf(SpecterIdempotencyConflictError)

    const version = await Effect.runPromise(
      Effect.flip(
        eventLog.append([{ type: 'other', payload: {} }], {
          expectedVersion: 0,
        }),
      ),
    )
    expect(version.cause).toBeInstanceOf(SpecterVersionConflictError)
  })

  it('serializes concurrent compare-and-swap appends', async () => {
    const { eventLog } = await setup()
    const append = (id: string) =>
      Effect.runPromise(
        eventLog.append([{ type: 'created', payload: { id } }], {
          expectedVersion: 0,
        }),
      )

    const results = await Promise.allSettled([append('one'), append('two')])
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1)
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1)
    expect(await Effect.runPromise(eventLog.currentVersion)).toBe(1)
  })
})

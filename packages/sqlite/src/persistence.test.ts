import { createClient } from '@libsql/client'
import { SpecterVersionConflictError } from '@specter-ts/core'
import {
  eventLogConformance,
  sliceStoreConformance,
} from '@specter-ts/core/testing'
import { Effect, Fiber } from 'effect'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createSqliteDatabaseContext } from './database'
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
  const context = createSqliteDatabaseContext(client)
  await Effect.runPromise(prepareSpecterSqlite(context))
  return createSpecterSqlitePersistence(context)
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
      store.transaction(
        { name: 'counter', version: 'v1' },
        (write, _read, _cursor, publish) =>
          Effect.gen(function* () {
            write.count = 3
            yield* publish(2)
          }),
      ),
    )
    await Effect.runPromise(
      Effect.result(
        store.transaction(
          { name: 'counter', version: 'v1' },
          (write, _read, _cursor, publish) =>
            Effect.gen(function* () {
              write.count = 9
              yield* publish(4)
              return yield* Effect.fail('rollback')
            }),
        ),
      ),
    )

    const visible = await Effect.runPromise(
      store.read({ name: 'counter', version: 'v1' }, (read, cursor) =>
        Effect.succeed({ count: read.count, cursor }),
      ),
    )
    expect(visible).toEqual({ count: 3, cursor: 2 })
  })

  it('joins nested Event Log appends to Slice Store transactions', async () => {
    const { eventLog, createSliceStoreService } = await setup()
    const store = createSliceStoreService(() => ({ count: 0 }))

    await Effect.runPromise(
      Effect.result(
        store.transaction(
          { name: 'reaction', version: 'v1' },
          (write, _read, _cursor, publish) =>
            Effect.gen(function* () {
              write.count = 1
              yield* eventLog.append([
                {
                  type: 'nested-command-recorded',
                  payload: { value: 1 },
                  keys: {},
                },
              ])
              yield* publish(1)
              return yield* Effect.fail('plugin-failed')
            }),
        ),
      ),
    )

    const events = await Effect.runPromise(
      eventLog.query(0, ['nested-command-recorded']),
    )
    const state = await Effect.runPromise(
      store.read({ name: 'reaction', version: 'v1' }, (read, cursor) =>
        Effect.succeed({ count: read.count, cursor }),
      ),
    )
    expect(events).toEqual([])
    expect(state).toEqual({ count: 0, cursor: 0 })
  })

  it('commits outbox enqueue with Slice State and cursor atomically', async () => {
    const { createReactionOutboxStore, createSliceStoreService } = await setup()
    const store = createSliceStoreService(() => ({ count: 0 }))
    const outbox = createReactionOutboxStore<{ message: string }>()
    const enqueue = outbox.enqueue({
      id: 'notify:1',
      idempotencyKey: 'notify:1',
      payload: { message: 'hello' },
      requestedAt: new Date(0),
      availableAt: new Date(0),
    })

    await Effect.runPromise(
      Effect.result(
        store.transaction(
          { name: 'notification', version: 'v1' },
          (write, _read, _cursor, publish) =>
            Effect.gen(function* () {
              write.count = 1
              yield* enqueue
              yield* publish(1)
              return yield* Effect.fail('plugin-failed')
            }),
        ),
      ),
    )

    expect(await Effect.runPromise(outbox.get('notify:1'))).toBeUndefined()
    expect(
      await Effect.runPromise(
        store.read({ name: 'notification', version: 'v1' }, (read, cursor) =>
          Effect.succeed({ count: read.count, cursor }),
        ),
      ),
    ).toEqual({ count: 0, cursor: 0 })

    await Effect.runPromise(
      store.transaction(
        { name: 'notification', version: 'v1' },
        (write, _read, _cursor, publish) =>
          Effect.gen(function* () {
            write.count = 1
            yield* enqueue
            yield* publish(1)
          }),
      ),
    )
    await Effect.runPromise(enqueue)

    expect(await Effect.runPromise(outbox.list())).toHaveLength(1)
    expect(
      await Effect.runPromise(
        store.read({ name: 'notification', version: 'v1' }, (read, cursor) =>
          Effect.succeed({ count: read.count, cursor }),
        ),
      ),
    ).toEqual({ count: 1, cursor: 1 })
  })

  it('does not leak completed transaction into child fibers', async () => {
    const { context, eventLog } = await setup()
    const version = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const scope = yield* Effect.scope
          const fiber = yield* context.transaction(() =>
            Effect.gen(function* () {
              yield* eventLog.append([
                {
                  type: 'nested-command-recorded',
                  payload: { value: 1 },
                  keys: {},
                },
              ])
              return yield* Effect.forkIn(
                Effect.sleep('5 millis').pipe(
                  Effect.andThen(eventLog.currentVersion),
                ),
                scope,
              )
            }),
          )
          return yield* Fiber.join(fiber)
        }),
      ),
    )
    expect(version).toBe(1)
  })

  it('returns first-commit receipts for reused keys and typed version conflicts', async () => {
    const { eventLog } = await setup()
    const first = await Effect.runPromise(
      eventLog.append(
        [{ type: 'todo-added', payload: { todoId: 'todo-1' }, keys: {} }],
        {
          expectedVersion: 0,
          idempotencyKey: 'request-1',
          fingerprint: 'fingerprint-1',
        },
      ),
    )
    const duplicate = await Effect.runPromise(
      eventLog.append([{ type: 'ignored', payload: {}, keys: {} }], {
        expectedVersion: 0,
        idempotencyKey: 'request-1',
        fingerprint: 'fingerprint-1',
      }),
    )
    expect(duplicate).toEqual({ ...first, duplicate: true })

    const changed = await Effect.runPromise(
      eventLog.append([{ type: 'other', payload: {}, keys: {} }], {
        idempotencyKey: 'request-1',
        fingerprint: 'fingerprint-2',
      }),
    )
    expect(changed).toEqual({ ...first, duplicate: true })
    expect(changed.fingerprint).toBe('fingerprint-1')

    const version = await Effect.runPromise(
      Effect.flip(
        eventLog.append([{ type: 'other', payload: {}, keys: {} }], {
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
        eventLog.append([{ type: 'created', payload: { id }, keys: {} }], {
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

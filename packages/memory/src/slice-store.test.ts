import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { createMemorySliceStoreService } from './slice-store'

const todosQuery = { name: 'todosQuery', version: 'v1' }
const countQuery = { name: 'countQuery', version: 'v1' }

describe('memory Slice Store', () => {
  it('commits state and cursor together and rolls both back on failure', async () => {
    const service = createMemorySliceStoreService(() => ({
      todos: [] as string[],
    }))
    await Effect.runPromise(
      service.transaction(todosQuery, (write, _read, _cursor, publish) =>
        Effect.gen(function* () {
          write.todos.push('one')
          yield* publish(1)
        }),
      ),
    )
    await Effect.runPromise(
      Effect.result(
        service.transaction(todosQuery, (write, _read, _cursor, publish) =>
          Effect.gen(function* () {
            write.todos.push('two')
            yield* publish(2)
            return yield* Effect.fail(new Error('projection failed'))
          }),
        ),
      ),
    )
    expect(service.inspect('todosQuery')).toEqual({
      state: { todos: ['one'] },
      lastAppliedOrder: 1,
      version: 'v1',
      reached: 1,
    })
  })

  it('starts a Slice from the state and cursor a host seeds, and catches up after it', async () => {
    const service = createMemorySliceStoreService(() => ({ count: 0 }), {
      initial: (slice) =>
        slice.name === 'countQuery' && slice.version === 'v1'
          ? { folded: { state: { count: 7 }, cursor: 12 } }
          : undefined,
    })
    await Effect.runPromise(
      service.transaction(countQuery, (write, _read, cursor, publish) =>
        Effect.gen(function* () {
          expect(cursor).toBe(12)
          write.count += 1
          yield* publish(13)
        }),
      ),
    )
    expect(service.inspect('countQuery')).toEqual({
      state: { count: 8 },
      lastAppliedOrder: 13,
      version: 'v1',
      reached: 13,
    })
    // A Slice the host has no snapshot for starts empty, and so does one
    // whose version is not the snapshot's.
    for (const slice of [
      { name: 'otherQuery', version: 'v1' },
      { name: 'countQuery', version: 'v2' },
    ]) {
      await Effect.runPromise(
        service.read(slice, (read, cursor) =>
          Effect.sync(() => expect([read, cursor]).toEqual([{ count: 0 }, 0])),
        ),
      )
    }
    expect(service.inspect('countQuery')?.version).toBe('v2')
  })

  it("keeps the cursor a Slice's name reached when its version changes", async () => {
    const service = createMemorySliceStoreService(() => ({ count: 0 }), {
      initial: (slice) =>
        slice.name === 'seededQuery' ? { reached: 30 } : undefined,
    })
    const reached = (slice: { name: string; version: string }) =>
      Effect.runPromise(
        service.read(slice, (_read, cursor, reached) =>
          Effect.succeed({ cursor, reached }),
        ),
      )
    await Effect.runPromise(
      service.transaction(countQuery, (_write, _read, _cursor, publish) =>
        publish(20),
      ),
    )
    expect(await reached(countQuery)).toEqual({ cursor: 20, reached: 20 })
    const upgraded = { ...countQuery, version: 'v2' }
    expect(await reached(upgraded)).toEqual({ cursor: 0, reached: 20 })
    await Effect.runPromise(
      service.transaction(upgraded, (_write, _read, _cursor, publish) =>
        publish(4),
      ),
    )
    expect(await reached(upgraded)).toEqual({ cursor: 4, reached: 20 })
    // A host may seed what a name reached without the State of its version.
    expect(await reached({ name: 'seededQuery', version: 'v1' })).toEqual({
      cursor: 0,
      reached: 30,
    })
  })

  it('exposes narrower read capability', async () => {
    const service = createMemorySliceStoreService(() => ({ count: 0 }), {
      read: (state) => ({ current: state.count }),
    })
    await Effect.runPromise(
      service.transaction(countQuery, (write, read, _cursor, publish) =>
        Effect.gen(function* () {
          write.count = 4
          expect(read()).toEqual({ current: 4 })
          yield* publish(1)
        }),
      ),
    )
    await expect(
      Effect.runPromise(
        service.read(countQuery, (read) => Effect.succeed(read)),
      ),
    ).resolves.toEqual({ current: 4 })
  })
})

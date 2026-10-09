import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { createMemorySliceStoreService } from './slice-store'

describe('memory Slice Store', () => {
  it('commits state and cursor together and rolls both back on failure', async () => {
    const service = createMemorySliceStoreService(() => ({
      todos: [] as string[],
    }))
    await Effect.runPromise(
      service.transaction('todosQuery', (write, _read, _cursor, publish) =>
        Effect.gen(function* () {
          write.todos.push('one')
          yield* publish(1)
        }),
      ),
    )
    await Effect.runPromise(
      Effect.result(
        service.transaction('todosQuery', (write, _read, _cursor, publish) =>
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
    })
  })

  it('starts a Slice from the state and cursor a host seeds, and catches up after it', async () => {
    const service = createMemorySliceStoreService(() => ({ count: 0 }), {
      initial: (sliceName) =>
        sliceName === 'countQuery'
          ? { state: { count: 7 }, cursor: 12 }
          : undefined,
    })
    await Effect.runPromise(
      service.transaction('countQuery', (write, _read, cursor, publish) =>
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
    })
    // A Slice the host has no snapshot for starts empty.
    await Effect.runPromise(
      service.read('otherQuery', (read, cursor) =>
        Effect.sync(() => expect([read, cursor]).toEqual([{ count: 0 }, 0])),
      ),
    )
  })

  it('exposes narrower read capability', async () => {
    const service = createMemorySliceStoreService(() => ({ count: 0 }), {
      read: (state) => ({ current: state.count }),
    })
    await Effect.runPromise(
      service.transaction('countQuery', (write, read, _cursor, publish) =>
        Effect.gen(function* () {
          write.count = 4
          expect(read()).toEqual({ current: 4 })
          yield* publish(1)
        }),
      ),
    )
    await expect(
      Effect.runPromise(
        service.read('countQuery', (read) => Effect.succeed(read)),
      ),
    ).resolves.toEqual({ current: 4 })
  })
})

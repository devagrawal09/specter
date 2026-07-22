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

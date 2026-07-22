import { ReactionScheduler } from '@specter-ts/core'
import { Effect, Fiber } from 'effect'
import { describe, expect, it } from 'vitest'

import { createImmediateReactionSchedulerLayer } from './reaction-scheduler'
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

describe('immediate Reaction scheduler', () => {
  it('serializes concurrent deliveries', async () => {
    const program = Effect.gen(function* () {
      const scheduler = yield* ReactionScheduler
      const contexts: string[] = []
      const first = yield* scheduler.schedule(1, (context) =>
        Effect.gen(function* () {
          contexts.push(context.deliveryId)
          yield* Effect.sleep('10 millis')
        }),
      )
      const second = yield* scheduler.schedule(2, (context) =>
        Effect.sync(() => contexts.push(context.deliveryId)),
      )
      const firstFiber = yield* Effect.forkChild(first)
      yield* second
      yield* Fiber.join(firstFiber)
      return contexts
    })
    const contexts = await Effect.runPromise(
      Effect.scoped(
        Effect.provide(program, createImmediateReactionSchedulerLayer()),
      ),
    )
    expect(contexts).toEqual([
      'memory-reaction-pass-1',
      'memory-reaction-pass-2',
    ])
  })
})

import { describe, expect, it } from 'vitest'
import { Effect } from 'effect'

import { createImmediateReactionScheduler } from './reaction-scheduler'
import { createMemorySliceStoreService } from './slice-store'

describe('memory Slice Store', () => {
  it('commits state and cursor together and rolls both back on failure', async () => {
    const service = createMemorySliceStoreService(() => ({ todos: [] as string[] }))

    await Effect.runPromise(
      service.transaction('todosQuery', async (write, _read, _cursor, publish) => {
        write.todos.push('one')
        await publish(1)
      }),
    )
    await expect(
      Effect.runPromise(
        service.transaction('todosQuery', async (write, _read, _cursor, publish) => {
          write.todos.push('two')
          await publish(2)
          throw new Error('projection failed')
        }),
      ),
    ).rejects.toThrow('projection failed')

    expect(service.inspect('todosQuery')).toEqual({
      state: { todos: ['one'] },
      lastAppliedOrder: 1,
    })
  })

  it('allows adapters to expose a narrower read capability over the same state', async () => {
    const service = createMemorySliceStoreService(() => ({ count: 0 }), {
      read: (state) => ({ current: state.count }),
    })

    await Effect.runPromise(
      service.transaction('countQuery', async (write, read, _cursor, publish) => {
        write.count = 4
        expect(read()).toEqual({ current: 4 })
        await publish(1)
      }),
    )
    await expect(
      Effect.runPromise(
        service.read('countQuery', async (read) => read),
      ),
    ).resolves.toEqual({ current: 4 })
  })
})

describe('immediate Reaction scheduler', () => {
  it('serializes requests made while a Reaction pass is running', async () => {
    let releaseFirst = () => {}
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    let calls = 0
    const contexts: string[] = []
    const request = createImmediateReactionScheduler({
      now: () => new Date('2026-07-16T00:00:00.000Z'),
    })(async (context) => {
      calls += 1
      contexts.push(context.deliveryId)
      if (calls === 1) await firstBlocked
    })

    const first = request()()
    const second = request()()
    releaseFirst()
    await Promise.all([first, second])

    expect(calls).toBe(2)
    expect(contexts).toEqual([
      'memory-reaction-pass-1',
      'memory-reaction-pass-2',
    ])
  })
})

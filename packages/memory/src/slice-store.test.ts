import { describe, expect, it } from 'vitest'

import { createImmediateReactionScheduler } from './reaction-scheduler'
import { createMemorySliceStore } from './slice-store'

describe('memory Slice Store', () => {
  it('commits state and cursor together and rolls both back on failure', async () => {
    const adapter = createMemorySliceStore(() => ({ todos: [] as string[] }))

    await adapter.transaction('todosQuery', async (store) => {
      store.write.todos.push('one')
      await store.setLastAppliedOrder(1)
    })
    await expect(
      adapter.transaction('todosQuery', async (store) => {
        store.write.todos.push('two')
        await store.setLastAppliedOrder(2)
        throw new Error('projection failed')
      }),
    ).rejects.toThrow('projection failed')

    expect(adapter.inspect('todosQuery')).toEqual({
      state: { todos: ['one'] },
      lastAppliedOrder: 1,
    })
  })

  it('allows adapters to expose a narrower read capability over the same state', async () => {
    const adapter = createMemorySliceStore(() => ({ count: 0 }), {
      read: (state) => ({ current: state.count }),
    })

    await adapter.transaction('countQuery', async (store) => {
      store.write.count = 4
      expect(store.read).toEqual({ current: 4 })
    })
    const store = await adapter.get('countQuery')
    expect(store.read).toEqual({ current: 4 })
  })

  it('publishes get-based projection work only when its cursor advances', async () => {
    const adapter = createMemorySliceStore(() => ({ todos: [] as string[] }))
    const failed = await adapter.get('todosQuery')
    failed.write.todos.push('partial')

    expect((await adapter.get('todosQuery')).read).toEqual({ todos: [] })

    const completed = await adapter.get('todosQuery')
    completed.write.todos.push('committed')
    await completed.setLastAppliedOrder(1)

    expect(adapter.inspect('todosQuery')).toEqual({
      state: { todos: ['committed'] },
      lastAppliedOrder: 1,
    })
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

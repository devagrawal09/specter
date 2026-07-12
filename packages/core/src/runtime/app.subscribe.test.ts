import type { StandardSchemaV1 } from '@standard-schema/spec'
import { describe, expect, test } from 'vitest'

import type {
  CommandEnvelope,
  EventLogAdapter,
  PersistedEvent,
  ReactionScheduler,
  SliceStoreAdapter,
} from '..'
import {
  createCommandSlice,
  createEventDefinition,
  createQuerySlice,
  createReactionSlice,
  event,
} from '..'
import { createSpecterApp } from './app'

const anySchema = {
  '~standard': {
    version: 1,
    vendor: 'specter-core-test',
    validate: (value: unknown) => ({ value }),
  },
} as StandardSchemaV1

const immediateReactionScheduler: ReactionScheduler = (run) => {
  let runRequested = false
  let activeRun: Promise<void> | undefined
  let waiters: { resolve: () => void; reject: (cause: unknown) => void }[] = []

  function resolveWaiters() {
    const settledWaiters = waiters
    waiters = []
    for (const waiter of settledWaiters) waiter.resolve()
  }

  function rejectWaiters(cause: unknown) {
    const settledWaiters = waiters
    waiters = []
    for (const waiter of settledWaiters) waiter.reject(cause)
  }

  async function drain() {
    try {
      do {
        runRequested = false
        await run()
      } while (runRequested)
      resolveWaiters()
    } catch (cause) {
      runRequested = false
      rejectWaiters(cause)
    } finally {
      activeRun = undefined
    }
  }

  return () => {
    runRequested = true
    if (!activeRun) activeRun = drain()

    return () => {
      if (!activeRun && !runRequested) return Promise.resolve()

      return new Promise<void>((resolve, reject) => {
        waiters.push({ resolve, reject })
      })
    }
  }
}

function createMemoryEventLog(): EventLogAdapter {
  let nextOrder = 1
  const events: PersistedEvent[] = []
  const adapter: EventLogAdapter = {
    async query(order, eventTypes) {
      return events.filter(
        (event) => event.order > order && eventTypes.includes(event.type),
      )
    },
    async append(drafts) {
      const appended = drafts.map((draft) => ({
        ...draft,
        id: `event-${nextOrder}`,
        order: nextOrder++,
        recordedAt: new Date(),
      }))
      events.push(...appended)
      return appended
    },
    transaction: (run) => run(adapter),
  }

  return adapter
}

function createMemoryStore<TState extends object>(
  initialState: TState,
): SliceStoreAdapter<TState, TState> {
  const state = initialState
  let lastAppliedOrder = 0
  const adapter: SliceStoreAdapter<TState, TState> = {
    async get() {
      return {
        write: state,
        read: state,
        lastAppliedOrder: async () => lastAppliedOrder,
        setLastAppliedOrder: async (order) => {
          lastAppliedOrder = order
        },
      }
    },
    async transaction(sliceName, run) {
      const store = await adapter.get(sliceName)
      return run(store)
    },
  }

  return adapter
}

function addCommand(
  name: string,
  definition: ReturnType<typeof eventDefinition>,
) {
  const specification = createCommandSlice(name)
    .description(name)
    .scenarios({
      description: `Emits ${definition.type}.`,
      given: [],
      when: 1,
      expect: [event(definition.type, 1)],
    })

  return specification
    .inputSchema<unknown>()
    .store(createMemoryStore({}))
    .handle(async (input) => [
      definition.create(typeof input === 'number' ? input : 1),
    ])
}

function countQuery(
  name: string,
  handleCalls: { count: number },
  definition = eventDefinition('item-added'),
) {
  const specification = createQuerySlice(name)
    .description('count items')
    .scenarios({
      description: `Counts ${definition.type}.`,
      given: [event(definition.type, 1)],
      when: {},
      expect: 1,
    })

  return specification
    .inputSchema<unknown>()
    .outputSchema<number>()
    .store(createMemoryStore({ count: 0 }))
    .apply(definition, async (event, state) => {
      state.count += Number(event.payload)
    })
    .handle(async (_input, state) => {
      handleCalls.count += 1
      return state.count
    })
}

function eventDefinition(type: string) {
  return createEventDefinition(type, anySchema)
}

async function withTimeout<T>(
  promise: Promise<T>,
  ms = 25,
): Promise<T | 'timeout'> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<'timeout'>((resolve) => {
        timeout = setTimeout(() => resolve('timeout'), ms)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

describe('createSpecterApp query subscriptions', () => {
  test('exposes subscribe.<queryName>() and emits the initial query result by default', async () => {
    const queryCalls = { count: 0 }
    const itemAdded = eventDefinition('item-added')
    const app = await createSpecterApp({
      events: [itemAdded],
      eventLog: createMemoryEventLog(),
      schedule: immediateReactionScheduler,
      slices: [
        addCommand('addItem', itemAdded),
        countQuery('countItems', queryCalls, itemAdded),
      ],
    })

    const iterator = app.subscribe.countItems({})[Symbol.asyncIterator]()

    await expect(iterator.next()).resolves.toEqual({ done: false, value: 0 })
    expect(queryCalls.count).toBe(1)

    await iterator.return?.()
  })

  test('invalidates matching query subscriptions after commands and reactions settle', async () => {
    const derivedQueryCalls = { count: 0 }
    const unrelatedQueryCalls = { count: 0 }
    const itemAdded = eventDefinition('item-added')
    const derivedAdded = eventDefinition('derived-added')
    const unrelatedAdded = eventDefinition('unrelated-added')
    const derivedQuery = countQuery(
      'countDerived',
      derivedQueryCalls,
      derivedAdded,
    )
    const unrelatedQuery = countQuery(
      'countUnrelated',
      unrelatedQueryCalls,
      unrelatedAdded,
    )

    const reactionState = createMemoryStore({ shouldEmitDerived: false })
    const deriveSpec = createReactionSlice('derive')
      .description('derive item')
      .scenarios({
        description: 'Requests a derived item after an item is added.',
        given: [event('item-added', 1)],
        expect: [{ type: 'addDerived', payload: 10 }],
      })
    const deriveReaction = deriveSpec
      .outputSchema<CommandEnvelope>()
      .plugin(async (dispatch) => async (command) => dispatch(command))
      .store(reactionState)
      .apply(itemAdded, async (_event, state) => {
        state.shouldEmitDerived = true
      })
      .handle(async (state) => {
        if (!state.shouldEmitDerived) return undefined
        state.shouldEmitDerived = false
        return { type: 'addDerived', payload: 10 }
      })

    const app = await createSpecterApp({
      events: [itemAdded, derivedAdded, unrelatedAdded],
      eventLog: createMemoryEventLog(),
      schedule: immediateReactionScheduler,
      slices: [
        addCommand('addItem', itemAdded),
        addCommand('addDerived', derivedAdded),
        derivedQuery,
        unrelatedQuery,
        deriveReaction,
      ],
    })

    const derived = app.subscribe.countDerived({})[Symbol.asyncIterator]()
    const unrelated = app.subscribe.countUnrelated({})[Symbol.asyncIterator]()
    await expect(derived.next()).resolves.toEqual({ done: false, value: 0 })
    await expect(unrelated.next()).resolves.toEqual({ done: false, value: 0 })

    const pendingDerived = derived.next()
    await app.addItem(1)

    await expect(pendingDerived).resolves.toEqual({ done: false, value: 10 })
    await expect(withTimeout(unrelated.next())).resolves.toBe('timeout')
    expect(unrelatedQueryCalls.count).toBe(1)

    await derived.return?.()
    await unrelated.return?.()
  })

  test('keeps only the latest buffered value when a subscriber is not waiting', async () => {
    const queryCalls = { count: 0 }
    const itemAdded = eventDefinition('item-added')
    const app = await createSpecterApp({
      events: [itemAdded],
      eventLog: createMemoryEventLog(),
      schedule: immediateReactionScheduler,
      slices: [
        addCommand('addItem', itemAdded),
        countQuery('countItems', queryCalls, itemAdded),
      ],
    })

    const iterator = app.subscribe.countItems({})[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toEqual({ done: false, value: 0 })

    await app.addItem(1)
    await app.addItem(1)

    await expect(iterator.next()).resolves.toEqual({ done: false, value: 2 })
    await expect(withTimeout(iterator.next())).resolves.toBe('timeout')

    await iterator.return?.()
  })

  test('cleans up subscriptions on return and when an AbortSignal aborts', async () => {
    const returnedQueryCalls = { count: 0 }
    const abortedQueryCalls = { count: 0 }
    const itemAdded = eventDefinition('item-added')
    const returnedQuery = countQuery(
      'returnedCount',
      returnedQueryCalls,
      itemAdded,
    )
    const abortedQuery = countQuery(
      'abortedCount',
      abortedQueryCalls,
      itemAdded,
    )

    const app = await createSpecterApp({
      events: [itemAdded],
      eventLog: createMemoryEventLog(),
      schedule: immediateReactionScheduler,
      slices: [addCommand('addItem', itemAdded), returnedQuery, abortedQuery],
    })

    const returned = app.subscribe.returnedCount({})[Symbol.asyncIterator]()
    await returned.next()
    await returned.return?.()

    const abortController = new AbortController()
    const aborted = app.subscribe
      .abortedCount({}, { signal: abortController.signal })
      [Symbol.asyncIterator]()
    await aborted.next()
    abortController.abort()

    await app.addItem(1)

    await expect(returned.next()).resolves.toEqual({
      done: true,
      value: undefined,
    })
    await expect(aborted.next()).resolves.toEqual({
      done: true,
      value: undefined,
    })
    expect(returnedQueryCalls.count).toBe(1)
    expect(abortedQueryCalls.count).toBe(1)
  })
})

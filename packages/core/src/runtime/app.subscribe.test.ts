import type { StandardSchemaV1 } from '@standard-schema/spec'
import { describe, expect, test } from 'vitest'

import type {
  EventLogAdapter,
  EventLogCommit,
  PersistedEvent,
  ReactionScheduler,
  SliceStoreAdapter,
} from '..'
import { createEventDefinition, SpecterVersionConflictError } from '..'
import {
  createCommandSlice,
  createQuerySlice,
  createReactionSlice,
  event,
} from '../spec-entry'
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
  let nextDelivery = 1
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

  async function drain(delivery: number) {
    try {
      do {
        runRequested = false
        await run({
          deliveryId: `delivery-${delivery}`,
          scheduledAt: '2026-07-16T00:00:00.000Z',
          attemptId: `delivery-${delivery}-attempt-1`,
          attemptNumber: 1,
        })
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
    if (!activeRun) activeRun = drain(nextDelivery++)

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
  const commits = new Map<string, EventLogCommit>()
  const adapter: EventLogAdapter = {
    async query(order, eventTypes) {
      return events.filter(
        (candidate) =>
          candidate.order > order && eventTypes.includes(candidate.type),
      )
    },
    async currentVersion() {
      return nextOrder - 1
    },
    async findCommit(idempotencyKey) {
      return commits.get(idempotencyKey)
    },
    async append(drafts, options = {}) {
      const version = nextOrder - 1
      if (
        options.expectedVersion !== undefined &&
        options.expectedVersion !== version
      ) {
        throw new SpecterVersionConflictError(options.expectedVersion, version)
      }
      const appended = drafts.map((draft) => ({
        ...draft,
        id: `event-${nextOrder}`,
        order: nextOrder++,
        recordedAt: new Date().toISOString(),
      }))
      events.push(...appended)
      const commit = {
        events: appended,
        version: nextOrder - 1,
        idempotencyKey: options.idempotencyKey,
        fingerprint: options.fingerprint,
      } satisfies EventLogCommit
      if (options.idempotencyKey) commits.set(options.idempotencyKey, commit)
      return { ...commit, duplicate: false }
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
      return run(await adapter.get(sliceName))
    },
  }

  return adapter
}

function eventDefinition(type: string) {
  return createEventDefinition(type, anySchema)
}

function addCommand(
  name: string,
  definition: ReturnType<typeof eventDefinition>,
) {
  return createCommandSlice(name)
    .description(name)
    .scenarios({
      description: `Emits ${definition.type}.`,
      given: [],
      when: 1,
      expect: [event(definition.type, 1)],
    })
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
  return createQuerySlice(name)
    .description('count items')
    .scenarios({
      description: `Counts ${definition.type}.`,
      given: [event(definition.type, 1)],
      when: {},
      expect: 1,
    })
    .inputSchema<unknown>()
    .outputSchema<number>()
    .store(createMemoryStore({ count: 0 }))
    .apply(definition, async (applied, state) => {
      state.count += Number(applied.payload)
    })
    .handle(async (_input, state) => {
      handleCalls.count += 1
      return state.count
    })
}

async function commandAndReactions(
  app: Awaited<ReturnType<typeof createSpecterApp>>,
  type: string,
  payload: unknown,
) {
  const execution = await app.command({ type, payload })
  await execution.reactions
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

describe('createSpecterApp Query subscriptions', () => {
  test('emits the initial Query result and fans updates out independently', async () => {
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

    const first = app
      .subscribe({ type: 'countItems', payload: {} })
      [Symbol.asyncIterator]()
    const second = app
      .subscribe({ type: 'countItems', payload: {} })
      [Symbol.asyncIterator]()

    await expect(first.next()).resolves.toEqual({ done: false, value: 0 })
    await expect(second.next()).resolves.toEqual({ done: false, value: 0 })
    const firstUpdate = first.next()
    const secondUpdate = second.next()
    await commandAndReactions(app, 'addItem', 1)

    await expect(firstUpdate).resolves.toEqual({ done: false, value: 1 })
    await expect(secondUpdate).resolves.toEqual({ done: false, value: 1 })
    await first.return?.()
    await second.return?.()
  })

  test('emits committed command state before a slow Reaction settles', async () => {
    let releaseReaction: (() => void) | undefined
    const reactionGate = new Promise<void>((resolve) => {
      releaseReaction = resolve
    })
    const itemAdded = eventDefinition('item-added')
    const slowReaction = createReactionSlice('slowDelivery')
      .description('Waits for an external effect.')
      .scenarios({
        description: 'Delivers after an item is added.',
        given: [event('item-added', 1)],
        expect: [1],
      })
      .outputSchema<number>()
      .plugin(async () => async () => {
        await reactionGate
      })
      .store(createMemoryStore({ value: 0 }))
      .apply(itemAdded, async (applied, state) => {
        state.value = Number(applied.payload)
      })
      .handle(async (state) => state.value)
    const app = await createSpecterApp({
      events: [itemAdded],
      eventLog: createMemoryEventLog(),
      schedule: immediateReactionScheduler,
      slices: [
        addCommand('addItem', itemAdded),
        countQuery('countItems', { count: 0 }, itemAdded),
        slowReaction,
      ],
    })
    const iterator = app
      .subscribe({ type: 'countItems', payload: {} })
      [Symbol.asyncIterator]()
    await iterator.next()
    const update = iterator.next()

    const execution = await app.command({ type: 'addItem', payload: 1 })

    await expect(withTimeout(update, 100)).resolves.toEqual({
      done: false,
      value: 1,
    })
    await expect(withTimeout(execution.reactions, 25)).resolves.toBe('timeout')
    releaseReaction?.()
    await execution.reactions
    await iterator.return?.()
  })

  test('resolves concurrent next calls FIFO across successive updates', async () => {
    const itemAdded = eventDefinition('item-added')
    const app = await createSpecterApp({
      events: [itemAdded],
      eventLog: createMemoryEventLog(),
      schedule: immediateReactionScheduler,
      slices: [
        addCommand('addItem', itemAdded),
        countQuery('countItems', { count: 0 }, itemAdded),
      ],
    })
    const iterator = app
      .subscribe({ type: 'countItems', payload: {} })
      [Symbol.asyncIterator]()
    await iterator.next()

    const first = iterator.next()
    const second = iterator.next()
    await commandAndReactions(app, 'addItem', 1)
    await commandAndReactions(app, 'addItem', 1)

    await expect(first).resolves.toEqual({ done: false, value: 1 })
    await expect(second).resolves.toEqual({ done: false, value: 2 })
    await iterator.return?.()
  })

  test('keeps only the latest buffered value for a slow subscriber', async () => {
    const itemAdded = eventDefinition('item-added')
    const app = await createSpecterApp({
      events: [itemAdded],
      eventLog: createMemoryEventLog(),
      schedule: immediateReactionScheduler,
      slices: [
        addCommand('addItem', itemAdded),
        countQuery('countItems', { count: 0 }, itemAdded),
      ],
    })
    const iterator = app
      .subscribe({ type: 'countItems', payload: {} })
      [Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toEqual({ done: false, value: 0 })

    await commandAndReactions(app, 'addItem', 1)
    await commandAndReactions(app, 'addItem', 1)

    await expect(iterator.next()).resolves.toEqual({ done: false, value: 2 })
    await expect(withTimeout(iterator.next())).resolves.toBe('timeout')
    await iterator.return?.()
  })

  test('treats undefined as a legitimate latest-state value', async () => {
    const valueSet = eventDefinition('value-set')
    const setValue = createCommandSlice('setValue')
      .description('Sets a value.')
      .scenarios({
        description: 'Sets a value.',
        given: [],
        when: 'ready',
        expect: [event('value-set', 'ready')],
      })
      .inputSchema<string | undefined>()
      .store(createMemoryStore({}))
      .handle(async (value) => [valueSet.create(value)])
    const currentValue = createQuerySlice('currentValue')
      .description('Reads an optional value.')
      .scenarios({
        description: 'Reads a value.',
        given: [event('value-set', 'ready')],
        when: {},
        expect: 'ready',
      })
      .inputSchema<Record<string, never>>()
      .outputSchema<string | undefined>()
      .store(
        createMemoryStore<{ value: string | undefined }>({
          value: undefined,
        }),
      )
      .apply(valueSet, async (applied, state) => {
        state.value = applied.payload as string | undefined
      })
      .handle(async (_query, state) => state.value)
    const app = await createSpecterApp({
      events: [valueSet],
      eventLog: createMemoryEventLog(),
      schedule: immediateReactionScheduler,
      slices: [setValue, currentValue],
    })
    const iterator = app
      .subscribe({ type: 'currentValue', payload: {} })
      [Symbol.asyncIterator]()

    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: undefined,
    })
    const repeatedUndefined = iterator.next()
    await commandAndReactions(app, 'setValue', undefined)
    await expect(repeatedUndefined).resolves.toEqual({
      done: false,
      value: undefined,
    })
    const update = iterator.next()
    await commandAndReactions(app, 'setValue', 'ready')
    await expect(update).resolves.toEqual({ done: false, value: 'ready' })
    await iterator.return?.()
  })

  test('does no work for a pre-aborted signal and closes all pending next calls', async () => {
    const calls = { count: 0 }
    const itemAdded = eventDefinition('item-added')
    const app = await createSpecterApp({
      events: [itemAdded],
      eventLog: createMemoryEventLog(),
      schedule: immediateReactionScheduler,
      slices: [
        addCommand('addItem', itemAdded),
        countQuery('countItems', calls, itemAdded),
      ],
    })
    const controller = new AbortController()
    controller.abort()
    const iterator = app
      .subscribe(
        { type: 'countItems', payload: {} },
        { signal: controller.signal },
      )
      [Symbol.asyncIterator]()

    await expect(iterator.next()).resolves.toEqual({
      done: true,
      value: undefined,
    })
    expect(calls.count).toBe(0)

    const activeController = new AbortController()
    const active = app
      .subscribe(
        { type: 'countItems', payload: {} },
        { signal: activeController.signal },
      )
      [Symbol.asyncIterator]()
    await active.next()
    const firstPending = active.next()
    const secondPending = active.next()
    activeController.abort()
    await expect(firstPending).resolves.toEqual({
      done: true,
      value: undefined,
    })
    await expect(secondPending).resolves.toEqual({
      done: true,
      value: undefined,
    })
  })

  test('does not rerun or emit unrelated Query subscriptions', async () => {
    const itemAdded = eventDefinition('item-added')
    const unrelatedAdded = eventDefinition('unrelated-added')
    const relatedCalls = { count: 0 }
    const unrelatedCalls = { count: 0 }
    const app = await createSpecterApp({
      events: [itemAdded, unrelatedAdded],
      eventLog: createMemoryEventLog(),
      schedule: immediateReactionScheduler,
      slices: [
        addCommand('addItem', itemAdded),
        addCommand('addUnrelated', unrelatedAdded),
        countQuery('countItems', relatedCalls, itemAdded),
        countQuery('countUnrelated', unrelatedCalls, unrelatedAdded),
      ],
    })
    const related = app
      .subscribe({ type: 'countItems', payload: {} })
      [Symbol.asyncIterator]()
    const unrelated = app
      .subscribe({ type: 'countUnrelated', payload: {} })
      [Symbol.asyncIterator]()
    await related.next()
    await unrelated.next()

    const relatedUpdate = related.next()
    await commandAndReactions(app, 'addItem', 1)

    await expect(relatedUpdate).resolves.toEqual({ done: false, value: 1 })
    await expect(withTimeout(unrelated.next())).resolves.toBe('timeout')
    expect(relatedCalls.count).toBe(2)
    expect(unrelatedCalls.count).toBe(1)
    await related.return?.()
    await unrelated.return?.()
  })
})

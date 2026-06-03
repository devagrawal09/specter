import type { StandardSchemaV1 } from '@standard-schema/spec'
import { describe, expect, it } from 'vitest'

import type {
  CommandEnvelope,
  EventLogAdapter,
  MaybePromise,
  PersistedEvent,
  SliceStoreAdapter,
} from '../index'
import {
  createCommandSlice,
  createEventDefinition,
  createQuerySlice,
  createReactionSlice,
  createSpecterApp,
} from '../index'
import { isPromiseLike } from './maybe-promise'

type WorkerPayload = {
  workerName: string
}

type EmptyInput = Record<string, never>

type MemoryState = {
  cursor: number
  workerRequests: string[]
  pendingWorker?: string
}

describe('sync and async runtime composition', () => {
  it('keeps sync adapters, schemas, handlers, and reactions synchronous', () => {
    const adapters = createSyncMemoryAdapters()
    const workerRequestedEvent = createEventDefinition(
      'workerRequested',
      schema<WorkerPayload>(),
    )
    const spawnIntentRecordedEvent = createEventDefinition(
      'spawnIntentRecorded',
      schema<WorkerPayload>(),
    )

    const requestWorker = createCommandSlice(
      'requestWorker',
      'Requests a worker.',
    )
      .schema(schema<WorkerPayload>())
      .store(adapters.sliceStore)
      .handle((command) => [workerRequestedEvent.create(command)])

    const recordSpawnIntent = createCommandSlice(
      'recordSpawnIntent',
      'Records a spawn intent.',
    )
      .schema(schema<WorkerPayload>())
      .store(adapters.sliceStore)
      .handle((command) => [spawnIntentRecordedEvent.create(command)])

    const workerRequestsQuery = createQuerySlice(
      'workerRequestsQuery',
      'Lists requested workers.',
    )
      .schema(schema<EmptyInput>())
      .store(adapters.sliceStore)
      .apply({
        [workerRequestedEvent.type]: (event, state) => {
          state.workerRequests.push(workerPayload(event.payload).workerName)
        },
      })
      .handle((_query, state) => state.workerRequests)

    const spawnIntentReaction = createReactionSlice(
      'spawnIntentReaction',
      'Creates a spawn intent for requested workers.',
    )
      .plugin((command) => (payload) => command(payload as CommandEnvelope))
      .store(adapters.sliceStore)
      .apply({
        [workerRequestedEvent.type]: (event, state) => {
          state.pendingWorker = workerPayload(event.payload).workerName
        },
        [spawnIntentRecordedEvent.type]: (event, state) => {
          const payload = workerPayload(event.payload)
          if (state.pendingWorker === payload.workerName) {
            state.pendingWorker = undefined
          }
        },
      })
      .handle((state) => {
        if (!state.pendingWorker) return undefined

        return {
          type: 'recordSpawnIntent',
          payload: { workerName: state.pendingWorker },
        }
      })

    const app = createSpecterApp({
      events: [workerRequestedEvent, spawnIntentRecordedEvent],
      eventLog: adapters.eventLog,
      slices: [
        requestWorker,
        recordSpawnIntent,
        workerRequestsQuery,
        spawnIntentReaction,
      ],
    })

    expectSync(app.requestWorker({ workerName: 'worker-1' }))
    expect(expectSync(app.workerRequestsQuery({}))).toEqual(['worker-1'])
    expect(expectSync(app.runtime.runReactions())).toBe(true)
    expect(expectSync(app.runtime.runReactions())).toBe(false)
    expect(adapters.events.map((event) => event.type)).toEqual([
      'workerRequested',
      'spawnIntentRecorded',
    ])
  })

  it('awaits async adapters, schemas, handlers, and apply handlers', async () => {
    const adapters = createAsyncMemoryAdapters()
    const workerRequestedEvent = createEventDefinition(
      'asyncWorkerRequested',
      asyncSchema<WorkerPayload>(),
    )

    const requestWorker = createCommandSlice(
      'requestAsyncWorker',
      'Requests a worker asynchronously.',
    )
      .schema(asyncSchema<WorkerPayload>())
      .store(adapters.sliceStore)
      .handle(async (command) => [workerRequestedEvent.create(command)])

    const workerRequestsQuery = createQuerySlice(
      'asyncWorkerRequestsQuery',
      'Lists asynchronously requested workers.',
    )
      .schema(asyncSchema<EmptyInput>())
      .store(adapters.sliceStore)
      .apply({
        [workerRequestedEvent.type]: async (event, state) => {
          state.workerRequests.push(workerPayload(event.payload).workerName)
        },
      })
      .handle(async (_query, state) => state.workerRequests)

    const app = createSpecterApp({
      events: [workerRequestedEvent],
      eventLog: adapters.eventLog,
      slices: [requestWorker, workerRequestsQuery],
    })

    await expectAsync(app.requestAsyncWorker({ workerName: 'worker-1' }))
    await expect(
      expectAsync(app.asyncWorkerRequestsQuery({})),
    ).resolves.toEqual(['worker-1'])
  })
})

function schema<T>(): StandardSchemaV1<unknown, T> {
  return {
    '~standard': {
      version: 1,
      vendor: 'specter-test',
      validate: (value) => ({ value: value as T }),
    },
  }
}

function asyncSchema<T>(): StandardSchemaV1<unknown, T> {
  return {
    '~standard': {
      version: 1,
      vendor: 'specter-test',
      validate: async (value) => ({ value: value as T }),
    },
  }
}

function workerPayload(value: unknown) {
  return value as WorkerPayload
}

function expectSync<T>(value: MaybePromise<T>) {
  expect(isPromiseLike(value)).toBe(false)
  if (isPromiseLike(value)) throw new Error('Expected sync value')

  return value
}

function expectAsync<T>(value: MaybePromise<T>) {
  expect(isPromiseLike(value)).toBe(true)
  if (!isPromiseLike(value)) throw new Error('Expected async value')

  return value
}

function createSyncMemoryAdapters() {
  const events: PersistedEvent[] = []
  const states = new Map<string, MemoryState>()

  const sliceStore: SliceStoreAdapter<MemoryState> = {
    get: createSliceStore,
    transaction: (sliceName, run) => run(createSliceStore(sliceName)),
  }
  const eventLog: EventLogAdapter = {
    query: (order, eventTypes) =>
      events.filter(
        (event) => event.order > order && eventTypes.includes(event.type),
      ),
    append: (eventDrafts) => {
      const appendedEvents: PersistedEvent[] = []

      for (const eventDraft of eventDrafts) {
        const persistedEvent = {
          ...eventDraft,
          id: `event-${events.length + 1}`,
          order: events.length + 1,
          recordedAt: new Date(0),
        } satisfies PersistedEvent

        events.push(persistedEvent)
        appendedEvents.push(persistedEvent)
      }

      return appendedEvents
    },
    transaction: (run) => run(eventLog),
  }

  function createSliceStore(sliceName: string) {
    const state = stateFor(sliceName)

    return {
      write: state,
      read: state,
      lastAppliedOrder: () => state.cursor,
      setLastAppliedOrder: (order: number) => {
        state.cursor = Math.max(state.cursor, order)
      },
    }
  }

  function stateFor(sliceName: string) {
    let state = states.get(sliceName)
    if (!state) {
      state = { cursor: 0, workerRequests: [] }
      states.set(sliceName, state)
    }

    return state
  }

  return { eventLog, events, sliceStore }
}

function createAsyncMemoryAdapters() {
  const syncAdapters = createSyncMemoryAdapters()
  const sliceStore: SliceStoreAdapter<MemoryState> = {
    get: syncAdapters.sliceStore.get,
    transaction: async (sliceName, run) =>
      run(syncAdapters.sliceStore.get(sliceName)),
  }
  const eventLog: EventLogAdapter = {
    query: async (order, eventTypes) =>
      syncAdapters.events.filter(
        (event) => event.order > order && eventTypes.includes(event.type),
      ),
    append: async (eventDrafts) => syncAdapters.eventLog.append(eventDrafts),
    transaction: async (run) => run(eventLog),
  }

  return {
    ...syncAdapters,
    eventLog,
    sliceStore,
  }
}

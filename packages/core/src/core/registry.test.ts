import * as Either from 'effect/Either'
import * as Schema from 'effect/Schema'
import { expect, it } from 'vitest'

import {
  createCommandSlice,
  defineApplyHandlers,
  createQuerySlice,
  createReactionSlice,
} from './builders'
import { createEventDefinition } from './event'
import type { EventDraft, PersistedEvent } from './event'
import type { CommandEnvelope } from './slice'
import type { EventLogAdapter, SliceStoreAdapter } from '../adapters/contracts'
import {
  createSpecterApp,
  EmptyCommandSetError,
  InvalidEventDraftError,
  ReactionRunError,
  UnknownEventTypeError,
} from './registry'

const observedEvent = createEventDefinition(
  'observed',
  Schema.Struct({ value: Schema.String }),
)

it('rejects apps without command slices', () => {
  const query = createQuerySlice('observedQuery')
    .schema(Schema.Struct({}))
    .store(createMemorySliceStore())
    .apply({})
    .handle(async () => [])

  expect(() =>
    createSpecterApp({
      events: [observedEvent],
      eventLog: createMemoryEventLog(),
      slices: [query],
    }),
  ).toThrow(EmptyCommandSetError)
})

it('accepts apply handlers keyed by registered Event Definitions', () => {
  const applyHandlers = defineApplyHandlers([observedEvent], {
    [observedEvent.type]: async () => {},
  })

  expect(Object.keys(applyHandlers)).toEqual([observedEvent.type])
})

it('passes typed apply handlers through slice builders', () => {
  const query = createQuerySlice('observedQuery')
    .schema(Schema.Struct({}))
    .store(createMemorySliceStore())
    .apply(
      defineApplyHandlers([observedEvent], {
        [observedEvent.type]: async (event) => {
          const value: string = event.payload.value

          expect(value).toBe(value)
        },
      }),
    )
    .handle(async () => [])

  expect(Object.keys(query.apply)).toEqual([observedEvent.type])
})

it('rejects slice apply keys that are not registered event definitions', () => {
  const command = createCommandSlice('noop')
    .schema(Schema.Struct({}))
    .store(createMemorySliceStore())
    .handle(async () => [])
  const query = createQuerySlice('badQuery')
    .schema(Schema.Struct({}))
    .store(createMemorySliceStore())
    .apply({ missingEvent: async () => {} })
    .handle(async () => [])

  expect(() =>
    createSpecterApp({
      events: [observedEvent],
      eventLog: createMemoryEventLog(),
      slices: [command, query],
    }),
  ).toThrow(UnknownEventTypeError)
})

it('validates known emitted event drafts before append', async () => {
  const eventLog = createMemoryEventLog()
  const command = createCommandSlice('emitInvalid')
    .schema(Schema.Struct({}))
    .store(createMemorySliceStore())
    .handle(async () => [{ type: observedEvent.type, payload: {} }])
  const app = createSpecterApp({
    events: [observedEvent],
    eventLog,
    slices: [command],
  })

  const dispatchResult = await app
    .emitInvalid({})
    .then(Either.right, Either.left)
  const persistedEvents = await eventLog.readAfter(0, [observedEvent.type])
  const result = { dispatchResult, persistedEvents }

  expect(Either.isLeft(result.dispatchResult)).toBe(true)
  if (!Either.isLeft(result.dispatchResult)) {
    throw new Error('Command unexpectedly succeeded')
  }
  expect(result.dispatchResult.left).toBeInstanceOf(InvalidEventDraftError)
  expect(result.persistedEvents).toEqual([])
})

it('aggregates reaction catch-up and handle failures while continuing others', async () => {
  const eventLog = createMemoryEventLog()
  const command = createCommandSlice('noop')
    .schema(Schema.Struct({}))
    .store(createMemorySliceStore())
    .handle(async () => [])
  const ranEffects: string[] = []
  const failingReaction = createReactionSlice('failingReaction')
    .plugin(async (command) => async (payload) => command(payload as CommandEnvelope))
    .store(createMemorySliceStore())
    .apply({
      [observedEvent.type]: async () => {},
    })
    .handle(async () => Promise.reject('handle failed'))
  const continuingReaction = createReactionSlice('continuingReaction')
    .plugin(async () => async () => {
      ranEffects.push('continuingReaction')
    })
    .store(createMemorySliceStore())
    .apply({
      [observedEvent.type]: async () => {},
    })
    .handle(async () => ({ type: 'noop', payload: {} }))
  const app = createSpecterApp({
    events: [observedEvent],
    eventLog,
    slices: [command, failingReaction, continuingReaction],
  })

  await eventLog.append([observedEvent.create({ value: 'seen' })])
  const result = await app.runtime.runReactions().then(Either.right, Either.left)

  expect(Either.isLeft(result)).toBe(true)
  if (!Either.isLeft(result)) {
    throw new Error('Reactions unexpectedly succeeded')
  }
  expect(result.left).toBeInstanceOf(ReactionRunError)
  expect(result.left).toMatchObject({
    failures: [{ reactionName: 'failingReaction', cause: 'handle failed' }],
  })
  expect(ranEffects).toEqual(['continuingReaction'])
})

function createMemoryEventLog(): EventLogAdapter {
  const events: PersistedEvent[] = []

  const eventLog: EventLogAdapter = {
    readAfter: async (order, eventTypes) =>
      events.filter(
        (event) => event.order > order && eventTypes.includes(event.type),
      ),
    append: async (eventDrafts: readonly EventDraft[]) => {
      const persisted = eventDrafts.map((eventDraft) => ({
        ...eventDraft,
        id: `event-${events.length + 1}`,
        order: events.length + 1,
        recordedAt: new Date(0),
      }))

      events.push(...persisted)

      return persisted
    },
    transaction: (run) => run(eventLog),
  }

  return eventLog
}

function createMemorySliceStore(): SliceStoreAdapter<Record<string, unknown>> {
  const stores = new Map<string, { state: Record<string, unknown>; order: number }>()

  return {
    get: createStore,
    transaction: (sliceName, run) => run(createStore(sliceName)),
  }

  function createStore(sliceName: string) {
    let store = stores.get(sliceName)

    if (!store) {
      store = { state: {}, order: 0 }
      stores.set(sliceName, store)
    }

    return {
      write: store.state,
      read: store.state,
      lastAppliedOrder: async () => store.order,
      setLastAppliedOrder: async (order: number) => {
        store.order = order
      },
    }
  }
}

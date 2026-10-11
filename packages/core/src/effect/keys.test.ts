import type { StandardSchemaV1 } from '@standard-schema/spec'
import { Context, Effect, Layer, type Scope } from 'effect'
import { describe, expect, it } from 'vitest'

import {
  type EventDraft,
  EventLog,
  type EventLogCommit,
  type EventLogDraft,
  EventLogFailure,
  type EventLogService,
  type PersistedEvent,
  type ReactionPlugin,
  SpecterConformanceError,
  SpecterInfrastructureError,
  SpecterVersionConflictError,
  createEventDefinition,
} from '..'
import { createCommandSlice, createReactionSlice, event } from '../definition'
import { createTestSliceStore } from '../testing/test-slice-store'
import { makeSpecterRuntime } from './runtime'

function schema<T>(): StandardSchemaV1<T, T> {
  return {
    '~standard': {
      version: 1,
      vendor: 'specter-keys-test',
      validate: (value) => ({ value: value as T }),
    },
  }
}

type Item = {
  readonly itemId: string
  readonly value: number
  readonly listId?: string
}

// An item's change names its item and, when it has one, its list: two ID
// spaces, so the same string under each name is two keys.
const itemChanged = createEventDefinition('item-changed', schema<Item>(), {
  keys: {
    item: (payload) => payload.itemId,
    list: (payload) => payload.listId,
  },
})
const itemReset = createEventDefinition('item-reset', schema<Item>(), {
  keys: { item: (payload) => payload.itemId },
})
const noteRecorded = createEventDefinition('note-recorded', schema<Item>(), {
  keys: { item: (payload) => payload.itemId },
})

/**
 * An in-memory Event Log that stores each Event's keys and honors both
 * compare-and-swap forms from them. `race` appends other writers' Events
 * before each of the next appends, as a concurrent writer that commits
 * between a decision's read and its append.
 */
function makeLog() {
  const events: PersistedEvent[] = []
  const keys = new Map<number, Readonly<Record<string, string>>>()
  const commits: EventLogCommit[] = []
  const races: EventLogDraft[][] = []
  const append = (drafts: readonly EventLogDraft[]) => {
    const persisted = drafts.map((draft, index) => {
      const order = events.length + index + 1
      keys.set(order, draft.keys)
      return {
        type: draft.type,
        payload: draft.payload,
        id: `event-${order}`,
        order,
        recordedAt: new Date(0).toISOString(),
      }
    })
    events.push(...persisted)
    const commit = {
      events: persisted,
      version: events.length,
      committedAt: new Date(0).toISOString(),
    }
    commits.push(commit)
    return commit
  }
  const service: EventLogService = {
    query: (after, types) =>
      Effect.sync(() =>
        events.filter(
          (item) => item.order > after && types.includes(item.type),
        ),
      ),
    readKey: (key) =>
      Effect.sync(() =>
        events.filter((item) => keys.get(item.order)?.[key.name] === key.value),
      ),
    currentVersion: Effect.sync(() => events.length),
    commitsAfter: (after) =>
      Effect.sync(() => commits.filter((commit) => commit.version > after)),
    findCommit: () => Effect.succeed(undefined),
    append: (drafts, options = {}) =>
      Effect.try({
        try: () => {
          const raced = races.shift()
          if (raced) append(raced)
          if (
            options.expectedVersion !== undefined &&
            options.expectedVersion !== events.length
          ) {
            throw new SpecterVersionConflictError(
              options.expectedVersion,
              events.length,
            )
          }
          const unchanged = options.expectedUnchanged
          const stale = unchanged
            ? events.find(
                (item) =>
                  item.order > unchanged.afterOrder &&
                  unchanged.eventTypes.includes(item.type) &&
                  (unchanged.keys === undefined ||
                    Object.entries(unchanged.keys).some(([name, values]) =>
                      values.includes(keys.get(item.order)?.[name] as string),
                    )),
              )
            : undefined
          if (unchanged && stale) {
            throw new SpecterVersionConflictError(
              unchanged.afterOrder,
              stale.order,
            )
          }
          return { ...append(drafts), duplicate: false }
        },
        catch: (cause) => new EventLogFailure('append', cause),
      }),
  }
  return {
    service,
    events,
    keys,
    // Raced item Events carry the keys their definition derives, unless given.
    race: (...drafts: readonly (readonly (EventDraft | EventLogDraft)[])[]) => {
      races.push(...drafts.map((raced) => raced.map(withItemKeys)))
    },
  }
}

function withItemKeys(draft: EventDraft | EventLogDraft): EventLogDraft {
  if ('keys' in draft) return draft
  const payload = draft.payload as Item
  return {
    ...draft,
    keys: {
      item: payload.itemId,
      ...(payload.listId === undefined ? {} : { list: payload.listId }),
    },
  }
}

function changeItem(options: { readonly keyed: boolean }) {
  const store = createTestSliceStore<{ values: Record<string, number> }>({
    values: {},
  })
  const handled: Item[] = []
  const spec = createCommandSlice('changeItem')
    .description('Changes an item unless it already holds the value.')
    .scenarios(
      {
        description: 'Changes an item.',
        given: [
          event('item-changed', { itemId: 'b', value: 1 }),
          event('item-reset', { itemId: 'a', value: 0 }),
        ],
        when: { itemId: 'a', value: 1 },
        expect: [event('item-changed', { itemId: 'a', value: 1 })],
      },
      {
        description: 'Refuses the value the item holds.',
        given: [event('item-changed', { itemId: 'a', value: 1 })],
        when: { itemId: 'a', value: 1 },
        expect: [],
        reject: { reason: 'Item unchanged' },
      },
    )
    .inputSchema<Item>()
  const stored = spec.store(store.tag)
  const keyed = options.keyed
    ? stored.consistencyKeys({ item: (command) => command.itemId })
    : stored
  const slice = keyed
    .apply(itemChanged, async (applied, state) => {
      state.values[applied.payload.itemId] = applied.payload.value
    })
    .apply(itemReset, async (applied, state) => {
      state.values[applied.payload.itemId] = applied.payload.value
    })
    .handle(async (command, state) => {
      handled.push(command)
      if (state.values[command.itemId] === command.value) {
        throw new Error('Item unchanged')
      }
      return [itemChanged.create(command)]
    })
  return { slice, store, handled }
}

const run = <A, E>(program: Effect.Effect<A, E, Scope.Scope>) =>
  Effect.runPromise(Effect.scoped(program))

describe('consistency keys', () => {
  async function dispatchWithRace(
    keyed: boolean,
    raced: readonly EventDraft[][],
    options: { readonly expectedVersion?: number } = {},
  ) {
    const log = makeLog()
    const { slice, store, handled } = changeItem({ keyed })
    const result = await run(
      Effect.gen(function* () {
        const app = yield* makeSpecterRuntime({
          // note-recorded is another writer's, which this app never reads.
          events: [itemChanged, itemReset],
          slices: { changeItem: slice },
        } as const).pipe(
          Effect.provide(
            Layer.mergeAll(Layer.succeed(EventLog, log.service), store.layer),
          ),
        )
        log.race(...raced)
        return yield* Effect.result(
          app.command(
            { type: 'changeItem', payload: { itemId: 'a', value: 2 } },
            options,
          ),
        )
      }),
    )
    return { result, handled, events: log.events, keys: log.keys }
  }

  it('lets a Command append when other writers appended only Event types it does not apply', async () => {
    const { result, handled, events } = await dispatchWithRace(false, [
      [{ type: 'note-recorded', payload: { itemId: 'a', value: 9 } }],
    ])
    expect(result._tag).toBe('Success')
    // Decided once: the new Event cannot change what it read.
    expect(handled).toHaveLength(1)
    expect(events.map((item) => item.type)).toEqual([
      'note-recorded',
      'item-changed',
    ])
  })

  it('decides again when another writer appended an Event type it applies', async () => {
    const { result, handled } = await dispatchWithRace(false, [
      [{ type: 'item-changed', payload: { itemId: 'b', value: 1 } }],
    ])
    expect(result._tag).toBe('Success')
    expect(handled).toHaveLength(2)
  })

  it('appends each Event with the keys its definition derives from the payload', async () => {
    const { keys } = await dispatchWithRace(true, [])
    expect([...keys.values()]).toEqual([{ item: 'a' }])
  })

  it('ignores an applied Event type for another key when the Command declares its keys', async () => {
    const { result, handled } = await dispatchWithRace(true, [
      [{ type: 'item-changed', payload: { itemId: 'b', value: 1 } }],
    ])
    expect(result._tag).toBe('Success')
    expect(handled).toHaveLength(1)
  })

  it('tells key names apart: the same value under another name is another key', async () => {
    const { result, handled } = await dispatchWithRace(true, [
      [
        {
          type: 'item-changed',
          payload: { itemId: 'b', value: 1, listId: 'a' },
        },
      ],
    ])
    expect(result._tag).toBe('Success')
    expect(handled).toHaveLength(1)
  })

  it('decides again for an Event of any applied type carrying its key', async () => {
    const sameKey = await dispatchWithRace(true, [
      [{ type: 'item-changed', payload: { itemId: 'a', value: 3 } }],
    ])
    expect(sameKey.result._tag).toBe('Success')
    expect(sameKey.handled).toHaveLength(2)

    const otherType = await dispatchWithRace(true, [
      [{ type: 'item-reset', payload: { itemId: 'a', value: 0 } }],
    ])
    expect(otherType.result._tag).toBe('Success')
    expect(otherType.handled).toHaveLength(2)

    // The re-decision reads what the winner wrote.
    const refused = await dispatchWithRace(true, [
      [{ type: 'item-changed', payload: { itemId: 'a', value: 2 } }],
    ])
    expect(refused.result._tag).toBe('Failure')
    expect(
      String(refused.result._tag === 'Failure' && refused.result.failure),
    ).toContain('Item unchanged')
  })

  it('surfaces the conflict once a writer on its key wins every one of its retries', async () => {
    const { result, handled } = await dispatchWithRace(
      true,
      Array.from({ length: 40 }, (_, index) => [
        { type: 'item-changed', payload: { itemId: 'a', value: 10 + index } },
      ]),
    )
    expect(result._tag).toBe('Failure')
    if (result._tag !== 'Failure') return
    expect(result.failure).toBeInstanceOf(EventLogFailure)
    expect((result.failure as EventLogFailure).cause).toBeInstanceOf(
      SpecterVersionConflictError,
    )
    // The first decision and 32 more.
    expect(handled).toHaveLength(33)
  })

  it('takes keys from the State the decision read', async () => {
    type Grouped = { readonly itemId: string; readonly group: string }
    const groupKeys = {
      item: (payload: Grouped) => payload.itemId,
      group: (payload: Grouped) => payload.group,
    }
    const itemGrouped = createEventDefinition(
      'item-grouped',
      schema<Grouped>(),
      { keys: groupKeys },
    )
    const itemActivated = createEventDefinition(
      'item-activated',
      schema<Grouped>(),
      { keys: groupKeys },
    )
    const store = createTestSliceStore<{
      groups: Record<string, string>
      active: Record<string, string>
    }>({ groups: {}, active: {} })
    const handled: string[] = []
    // One active item per group: the decision reads the item's group, which
    // only its State knows.
    const activateItem = createCommandSlice('activateItem')
      .description('Makes an item its group active one.')
      .scenarios({
        description: 'Activates an item of a group.',
        given: [
          event('item-grouped', { itemId: 'a', group: 'g' }),
          event('item-activated', { itemId: 'b', group: 'g' }),
        ],
        when: { itemId: 'a' },
        expect: [event('item-activated', { itemId: 'a', group: 'g' })],
      })
      .inputSchema<{ readonly itemId: string }>()
      .store(store.tag)
      .consistencyKeys({
        item: (command) => command.itemId,
        group: (command, state) => state.groups[command.itemId],
      })
      .apply(itemGrouped, async (applied, state) => {
        state.groups[applied.payload.itemId] = applied.payload.group
      })
      .apply(itemActivated, async (applied, state) => {
        state.active[applied.payload.group] = applied.payload.itemId
      })
      .handle(async (command, state) => {
        handled.push(command.itemId)
        const group = state.groups[command.itemId]
        if (!group) throw new Error('Item not found')
        if (state.active[group] === command.itemId) {
          throw new Error('Item already active')
        }
        return [itemActivated.create({ itemId: command.itemId, group })]
      })
    const dispatch = (raced: readonly EventDraft[]) => {
      const log = makeLog()
      handled.length = 0
      store.reset()
      return run(
        Effect.gen(function* () {
          const app = yield* makeSpecterRuntime({
            events: [itemGrouped, itemActivated],
            slices: { activateItem },
          } as const).pipe(
            Effect.provide(
              Layer.mergeAll(Layer.succeed(EventLog, log.service), store.layer),
            ),
          )
          yield* log.service.append([
            {
              type: 'item-grouped',
              payload: { itemId: 'a', group: 'g' },
              keys: { item: 'a', group: 'g' },
            },
          ])
          log.race(
            raced.map((draft) => ({
              ...draft,
              keys: {
                item: (draft.payload as Grouped).itemId,
                group: (draft.payload as Grouped).group,
              },
            })),
          )
          yield* app.command({ type: 'activateItem', payload: { itemId: 'a' } })
          return handled.length
        }),
      )
    }
    // Another group's activation cannot change the decision.
    await expect(
      dispatch([
        { type: 'item-activated', payload: { itemId: 'c', group: 'h' } },
      ]),
    ).resolves.toBe(1)
    // The same group's can: the decision runs again.
    await expect(
      dispatch([
        { type: 'item-activated', payload: { itemId: 'b', group: 'g' } },
      ]),
    ).resolves.toBe(2)
  })

  it('keeps the whole-log check for a caller expectedVersion', async () => {
    const { result, handled } = await dispatchWithRace(
      true,
      [[{ type: 'note-recorded', payload: { itemId: 'b', value: 9 } }]],
      { expectedVersion: 0 },
    )
    expect(result._tag).toBe('Failure')
    expect(handled).toHaveLength(1)
  })
})

describe('keyed Reactions', () => {
  function itemWatch() {
    const store = createTestSliceStore<{ values: Record<string, number> }>({
      values: {},
    })
    const delivered: Array<{ readonly output: Item; readonly id: string }> = []
    const plugin: ReactionPlugin<Item> = () =>
      Effect.succeed((output, context) =>
        Effect.sync(() => {
          delivered.push({ output, id: context.deliveryId })
        }),
      )
    const slice = createReactionSlice('itemWatch')
      .description('Reports each changed item.')
      .scenarios({
        description: 'Reports a changed item.',
        given: [
          event('item-changed', { itemId: 'a', value: 1, listId: 'l' }),
          event('note-recorded', { itemId: 'a', value: 1 }),
        ],
        expect: [{ itemId: 'a', value: 1 }],
      })
      .outputSchema<Item>()
      .plugin(plugin)
      .store(store.tag)
      .apply(itemChanged, async (changed, state) => {
        state.values[changed.payload.itemId] = changed.payload.value
      })
      .apply(noteRecorded, async () => {})
      .handleEachKey('item', async (state, itemId) => {
        const value = state.values[itemId]
        return value === undefined ? undefined : { itemId, value }
      })
    return { slice, store, delivered }
  }

  function recordItems() {
    const store = createTestSliceStore({})
    const slice = createCommandSlice('recordItems')
      .description('Records items.')
      .scenarios({
        description: 'Records items.',
        given: [],
        when: [{ itemId: 'a', value: 1, listId: 'l' }],
        expect: [event('item-changed', { itemId: 'a', value: 1, listId: 'l' })],
      })
      .inputSchema<readonly Item[]>()
      .store(store.tag)
      .handle(async (items) => items.map((item) => itemChanged.create(item)))
    return { slice, store }
  }

  it('handles each value of its key a commit carries, each a delivery of its own', async () => {
    const log = makeLog()
    const { slice, store, delivered } = itemWatch()
    const command = recordItems()
    await run(
      Effect.gen(function* () {
        const app = yield* makeSpecterRuntime({
          events: [itemChanged, noteRecorded],
          slices: { recordItems: command.slice, itemWatch: slice },
        } as const).pipe(
          Effect.provide(
            Layer.mergeAll(
              Layer.succeed(EventLog, log.service),
              store.layer,
              command.store.layer,
            ),
          ),
        )
        const first = yield* app.command({
          type: 'recordItems',
          payload: [
            { itemId: 'b', value: 1, listId: 'l' },
            { itemId: 'a', value: 2, listId: 'l' },
            { itemId: 'b', value: 3 },
          ],
        })
        yield* first.reactions
        const second = yield* app.command({
          type: 'recordItems',
          payload: [{ itemId: 'a', value: 4 }],
        })
        yield* second.reactions
      }),
    )
    expect(delivered).toEqual([
      // The items, not the list both name: the Reaction is keyed by item.
      { output: { itemId: 'b', value: 3 }, id: 'itemWatch:3:b' },
      { output: { itemId: 'a', value: 2 }, id: 'itemWatch:3:a' },
      // Only the item the second commit carries: b's State did not change.
      { output: { itemId: 'a', value: 4 }, id: 'itemWatch:4:a' },
    ])
  })

  it('refuses to append an Event without a key a keyed Slice applies it by', async () => {
    const log = makeLog()
    const store = createTestSliceStore<Record<string, never>>({})
    const listWatch = createReactionSlice('listWatch')
      .description('Watches lists.')
      .scenarios({
        description: 'Ignores a change.',
        given: [event('item-changed', { itemId: 'a', value: 1, listId: 'l' })],
        expect: [],
      })
      .outputSchema<Item>()
      .plugin(() => Effect.succeed(() => Effect.void))
      .store(store.tag)
      .apply(itemChanged, async () => {})
      .handleEachKey('list', async () => undefined)
    const command = recordItems()
    const result = await run(
      Effect.gen(function* () {
        const app = yield* makeSpecterRuntime({
          events: [itemChanged],
          slices: { recordItems: command.slice, listWatch },
        } as const).pipe(
          Effect.provide(
            Layer.mergeAll(
              Layer.succeed(EventLog, log.service),
              store.layer,
              command.store.layer,
            ),
          ),
        )
        return yield* Effect.result(
          app.command({
            type: 'recordItems',
            payload: [{ itemId: 'a', value: 1 }],
          }),
        )
      }),
    )
    expect(result._tag).toBe('Failure')
    if (result._tag !== 'Failure') return
    expect(result.failure).toBeInstanceOf(SpecterInfrastructureError)
    expect(result.failure.message).toContain(
      'Event "item-changed" carries none of the keys (list) that keyed Slice "listWatch" applies it by.',
    )
    expect(log.events).toEqual([])
  })

  it('rejects a keyed Reaction that applies an Event type without its key', async () => {
    const store = createTestSliceStore({})
    const slice = createReactionSlice('resetWatch')
      .description('Watches resets.')
      .scenarios({
        description: 'Ignores a reset.',
        given: [event('item-reset', { itemId: 'a', value: 0 })],
        expect: [],
      })
      .outputSchema<Item>()
      .plugin(() => Effect.succeed(() => Effect.void))
      .store(store.tag)
      .apply(itemReset, async () => {})
      .handleEachKey('list', async () => undefined)
    const result = await run(
      Effect.result(
        makeSpecterRuntime({
          events: [itemReset, itemChanged],
          slices: {
            resetWatch: slice,
            changeItem: changeItem({ keyed: false }).slice,
          },
        } as const).pipe(
          Effect.provide(
            Layer.mergeAll(
              Layer.succeed(EventLog, makeLog().service),
              store.layer,
              createTestSliceStore({}).layer,
            ),
          ),
        ),
      ),
    )
    expect(result._tag).toBe('Failure')
    if (result._tag !== 'Failure') return
    expect(result.failure).toBeInstanceOf(SpecterConformanceError)
    expect(
      (result.failure as SpecterConformanceError).diagnostics.map(
        (diagnostic) => diagnostic.code,
      ),
    ).toContain('keyed-reaction-undeclared-key')
  })
})

class Notifier extends Context.Service<
  Notifier,
  { readonly notify: (item: Item) => void }
>()('specter-keys-test/Notifier') {}

describe('deferred Reactions', () => {
  it('holds Reactions until start, which supplies Plugin services and runs them through the log', async () => {
    const log = makeLog()
    const notified: Item[] = []
    let initialized = 0
    const store = createTestSliceStore<{ latest?: Item }>({})
    const notifyPlugin: ReactionPlugin<Item, Notifier> = () =>
      Effect.gen(function* () {
        initialized += 1
        const notifier = yield* Notifier
        return (item) => Effect.sync(() => notifier.notify(item))
      })
    const notify = createReactionSlice('notifyItem')
      .description('Notifies the latest changed item.')
      .scenarios({
        description: 'Notifies a changed item.',
        given: [event('item-changed', { itemId: 'a', value: 1 })],
        expect: [{ itemId: 'a', value: 1 }],
      })
      .outputSchema<Item>()
      .plugin(notifyPlugin)
      .store(store.tag)
      .apply(itemChanged, async (changed, state) => {
        state.latest = changed.payload
      })
      .handle(async (state) => state.latest)
    const { slice, store: commandStore } = changeItem({ keyed: true })
    await run(
      Effect.gen(function* () {
        // No Notifier here: the deferred runtime does not need it.
        const app = yield* makeSpecterRuntime(
          {
            events: [itemChanged, itemReset],
            slices: { changeItem: slice, notifyItem: notify },
          } as const,
          { reactions: 'deferred' },
        ).pipe(
          Effect.provide(
            Layer.mergeAll(
              Layer.succeed(EventLog, log.service),
              store.layer,
              commandStore.layer,
            ),
          ),
        )
        const before = yield* app.command({
          type: 'changeItem',
          payload: { itemId: 'a', value: 1 },
        })
        // Completes at once, having run nothing.
        yield* before.reactions
        expect(initialized).toBe(0)
        expect(notified).toEqual([])

        const notifier = Notifier.of({ notify: (item) => notified.push(item) })
        yield* app.start.pipe(Effect.provideService(Notifier, notifier))
        expect(initialized).toBe(1)
        expect(notified).toEqual([{ itemId: 'a', value: 1 }])

        const after = yield* app.command({
          type: 'changeItem',
          payload: { itemId: 'b', value: 2 },
        })
        yield* after.reactions
        // Starting again changes nothing.
        yield* app.start.pipe(Effect.provideService(Notifier, notifier))
        expect(initialized).toBe(1)
        expect(notified).toEqual([
          { itemId: 'a', value: 1 },
          { itemId: 'b', value: 2 },
        ])
      }),
    )
  })
})

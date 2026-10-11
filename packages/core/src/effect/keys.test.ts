import type { StandardSchemaV1 } from '@standard-schema/spec'
import { Effect, Layer, type Scope } from 'effect'
import { describe, expect, it } from 'vitest'

import {
  type EventDraft,
  EventLog,
  type EventLogCommit,
  EventLogFailure,
  type EventLogService,
  type PersistedEvent,
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

type Item = { readonly itemId: string; readonly value: number }

const itemChanged = createEventDefinition('item-changed', schema<Item>(), {
  keys: (payload) => [payload.itemId],
})
// Same shape, no keys: every keyed decision over its type depends on it.
const itemReset = createEventDefinition('item-reset', schema<Item>())
/**
 * An in-memory Event Log that honors both compare-and-swap forms. `race`
 * appends other writers' Events before each of the next appends, as a
 * concurrent writer that commits between a decision's read and its append.
 */
function makeLog() {
  const events: PersistedEvent[] = []
  const commits: EventLogCommit[] = []
  const races: EventDraft[][] = []
  const append = (drafts: readonly EventDraft[]) => {
    const persisted = drafts.map((draft, index) => ({
      ...draft,
      id: `event-${events.length + index + 1}`,
      order: events.length + index + 1,
      recordedAt: new Date(0).toISOString(),
    }))
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
                  (unchanged.matches?.(item) ?? true),
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
    race: (...drafts: readonly EventDraft[][]) => {
      races.push(...drafts)
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
  const keyed = options.keyed
    ? spec.consistencyKeys((command) => [command.itemId])
    : spec
  const slice = keyed
    .store(store.tag)
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
    return { result, handled, events: log.events }
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

  it('ignores an applied Event type for another key when the Command declares its keys', async () => {
    const { result, handled } = await dispatchWithRace(true, [
      [{ type: 'item-changed', payload: { itemId: 'b', value: 1 } }],
    ])
    expect(result._tag).toBe('Success')
    expect(handled).toHaveLength(1)
  })

  it('decides again for an Event carrying its key, or an unkeyed one it applies', async () => {
    const sameKey = await dispatchWithRace(true, [
      [{ type: 'item-changed', payload: { itemId: 'a', value: 3 } }],
    ])
    expect(sameKey.result._tag).toBe('Success')
    expect(sameKey.handled).toHaveLength(2)

    const unkeyed = await dispatchWithRace(true, [
      [{ type: 'item-reset', payload: { itemId: 'b', value: 0 } }],
    ])
    expect(unkeyed.result._tag).toBe('Success')
    expect(unkeyed.handled).toHaveLength(2)

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

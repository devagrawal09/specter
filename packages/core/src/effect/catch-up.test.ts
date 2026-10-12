import type { StandardSchemaV1 } from '@standard-schema/spec'
import { Context, Effect, Layer, type Scope } from 'effect'
import { describe, expect, it } from 'vitest'

import {
  EventLog,
  type EventLogCommit,
  EventLogFailure,
  type EventLogService,
  type PersistedEvent,
  type SliceStoreService,
  type SliceStoreSlice,
  createEventDefinition,
} from '..'
import {
  createCommandSlice,
  createQuerySlice,
  createReactionSlice,
  event,
} from '../definition'
import { makeSpecterRuntime } from './runtime'

function schema<T>(): StandardSchemaV1<T, T> {
  return {
    '~standard': {
      version: 1,
      vendor: 'specter-catch-up-test',
      validate: (value) => ({ value: value as T }),
    },
  }
}

const valueRecorded = createEventDefinition('value-recorded', schema<number>())

type Values = { values: number[] }

/**
 * An in-memory Event Log holding one commit per value, which honors a read's
 * limit and records every read.
 */
function makeLog(values: readonly number[]) {
  const events: PersistedEvent[] = values.map((value, index) => ({
    type: 'value-recorded',
    payload: value,
    id: `event-${index + 1}`,
    order: index + 1,
    recordedAt: new Date(index + 1).toISOString(),
    keys: {},
  }))
  const commits: EventLogCommit[] = events.map((recorded) => ({
    events: [recorded],
    version: recorded.order,
    committedAt: recorded.recordedAt,
  }))
  const reads: string[] = []
  const service: EventLogService = {
    capabilities: { scopedAppend: true, keyedRead: false },
    query: (after, types, page = {}) =>
      Effect.sync(() => {
        reads.push(`query ${after} ${page.limit}`)
        return events
          .filter((item) => item.order > after && types.includes(item.type))
          .slice(0, page.limit)
      }),
    readKey: () =>
      Effect.fail(new EventLogFailure('readKey', new Error('Unsupported.'))),
    currentVersion: Effect.sync(() => events.length),
    commitsAfter: (after, page = {}) =>
      Effect.sync(() => {
        reads.push(`commits ${after} ${page.limit}`)
        return commits
          .filter((commit) => commit.version > after)
          .slice(0, page.limit)
      }),
    findCommit: () => Effect.succeed(undefined),
    append: () =>
      Effect.fail(new EventLogFailure('append', new Error('Read only.'))),
    purge: () =>
      Effect.fail(new EventLogFailure('purge', new Error('Read only.'))),
  }
  return { service, reads }
}

/**
 * A Store that keeps one State per Slice under its version, as a persistent
 * Store does: a call of another version starts the Slice empty. It records
 * the version of every call.
 */
function makeVersionedStore() {
  const entries = new Map<
    string,
    { version: string; state: Values; cursor: number }
  >()
  const versions: string[] = []
  const entry = (slice: SliceStoreSlice) => {
    versions.push(`${slice.name} ${slice.version}`)
    const current = entries.get(slice.name)
    if (current?.version === slice.version) return current
    const created = { version: slice.version, state: { values: [] }, cursor: 0 }
    entries.set(slice.name, created)
    return created
  }
  const service: SliceStoreService<Readonly<Values>, Values> = {
    read: (slice, run) =>
      Effect.suspend(() => {
        const current = entry(slice)
        return run(current.state, current.cursor)
      }),
    transaction: (slice, run) =>
      Effect.gen(function* () {
        const working = structuredClone(entry(slice))
        let published = false
        const result = yield* run(
          working.state,
          () => working.state,
          working.cursor,
          (order) =>
            Effect.sync(() => {
              working.cursor = order
              published = true
            }),
        )
        if (published) entries.set(slice.name, working)
        return result
      }),
  }
  return { service, versions }
}

class ValuesStore extends Context.Service<
  ValuesStore,
  SliceStoreService<Readonly<Values>, Values>
>()('specter-catch-up-test/ValuesStore') {}

function valuesQuery(options: { stateVersion?: number } = {}) {
  let applied = 0
  const slice = createQuerySlice('values')
    .description('Lists every recorded value.')
    .scenarios({
      description: 'Lists one value.',
      given: [event('value-recorded', 1)],
      when: {},
      expect: [1],
    })
    .inputSchema<Record<string, never>>()
    .outputSchema<readonly number[]>()
    .store(ValuesStore, options)
    .apply(valueRecorded, async (recorded, state) => {
      applied += 1
      state.values.push(recorded.payload)
    })
    .handle(async (_query, state) => state.values)
  return { slice, applied: () => applied }
}

const recordValue = createCommandSlice('recordValue')
  .description('Records one value.')
  .scenarios({
    description: 'Records one value.',
    given: [],
    when: 1,
    expect: [event('value-recorded', 1)],
  })
  .inputSchema<number>()
  .store(ValuesStore)
  .handle(async (value) => [valueRecorded.create(value)])

const run = <A, E>(program: Effect.Effect<A, E, Scope.Scope>) =>
  Effect.runPromise(Effect.scoped(program))

describe('Catch-up', () => {
  it('folds a Slice one page of Events at a time', async () => {
    const log = makeLog([1, 2, 3, 4, 5])
    const store = makeVersionedStore()
    const values = valuesQuery()
    const result = await run(
      Effect.gen(function* () {
        const app = yield* makeSpecterRuntime(
          {
            events: [valueRecorded],
            slices: { recordValue, values: values.slice },
          },
          { readPageSize: 2 },
        )
        return yield* app.query({ type: 'values', payload: {} })
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(EventLog, log.service),
            Layer.succeed(ValuesStore, store.service),
          ),
        ),
      ),
    )
    expect(result).toEqual([1, 2, 3, 4, 5])
    expect(log.reads).toEqual(['query 0 2', 'query 2 2', 'query 4 2'])
  })

  it('reads one page of commits at a time while a Reaction catches up', async () => {
    const log = makeLog([1, 2, 3, 4, 5])
    const store = makeVersionedStore()
    const delivered: string[] = []
    const publishValue = createReactionSlice('publishValue')
      .description('Publishes every recorded value.')
      .scenarios({
        description: 'Publishes one value.',
        given: [event('value-recorded', 1)],
        expect: 1,
      })
      .outputSchema<number>()
      .plugin(() =>
        Effect.succeed((value, context) =>
          Effect.sync(() => {
            delivered.push(`${context.deliveryId}=${value}`)
          }),
        ),
      )
      .store(ValuesStore)
      .apply(valueRecorded, async (recorded, state) => {
        state.values.push(recorded.payload)
      })
      .handle(async (state) => state.values.at(-1))
    await run(
      makeSpecterRuntime(
        { events: [valueRecorded], slices: { recordValue, publishValue } },
        { readPageSize: 2 },
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(EventLog, log.service),
            Layer.succeed(ValuesStore, store.service),
          ),
        ),
      ),
    )
    expect(delivered).toEqual([
      'publishValue:1=1',
      'publishValue:2=2',
      'publishValue:3=3',
      'publishValue:4=4',
      'publishValue:5=5',
    ])
    expect(log.reads).toEqual(['commits 0 2', 'commits 2 2', 'commits 4 2'])
  })

  it("gives its Store each Slice's State version, and a new one folds the log again", async () => {
    const log = makeLog([1, 2, 3])
    const store = makeVersionedStore()
    const boot = (values: ReturnType<typeof valuesQuery>) =>
      run(
        Effect.gen(function* () {
          const app = yield* makeSpecterRuntime({
            events: [valueRecorded],
            slices: { recordValue, values: values.slice },
          })
          return yield* app.query({ type: 'values', payload: {} })
        }).pipe(
          Effect.provide(
            Layer.mergeAll(
              Layer.succeed(EventLog, log.service),
              Layer.succeed(ValuesStore, store.service),
            ),
          ),
        ),
      )

    const first = valuesQuery()
    expect(await boot(first)).toEqual([1, 2, 3])
    // The same version catches up from the Store's cursor.
    const again = valuesQuery()
    expect(await boot(again)).toEqual([1, 2, 3])
    // A State of another shape has another version: the Store starts it
    // empty, and the Slice folds the log from its start.
    const reshaped = valuesQuery({ stateVersion: 2 })
    expect(await boot(reshaped)).toEqual([1, 2, 3])
    expect([first.applied(), again.applied(), reshaped.applied()]).toEqual([
      3, 0, 3,
    ])
    const digest = first.slice.specificationDigest
    expect(new Set(store.versions)).toEqual(
      new Set([`values ${digest}/1`, `values ${digest}/2`]),
    )
  })

  it('refuses a read page size that is not a positive integer', async () => {
    const log = makeLog([])
    const store = makeVersionedStore()
    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        makeSpecterRuntime(
          {
            events: [valueRecorded],
            slices: { recordValue, values: valuesQuery().slice },
          },
          { readPageSize: 0 },
        ),
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(EventLog, log.service),
            Layer.succeed(ValuesStore, store.service),
          ),
        ),
      ),
    )
    expect(exit._tag).toBe('Failure')
  })
})

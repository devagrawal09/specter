import { Cause, Effect, Exit } from 'effect'
import { describe, it } from 'vitest'

import type {
  EventLogFailure,
  EventLogService,
  SliceSnapshot,
  SliceSnapshotStore,
  SliceStoreService,
  SliceStoreSlice,
} from '../adapters'
import { type PersistedEvent, valuesEqual } from '../definition'
import { SpecterVersionConflictError } from '../runtime/errors'

export class AdapterConformanceFailure extends Error {
  readonly _tag = 'AdapterConformanceFailure' as const

  constructor(
    readonly adapter:
      | 'event-log'
      | 'slice-store'
      | 'slice-snapshot-store'
      | 'reaction-outbox-store',
    readonly invariant: string,
    readonly actual: unknown,
  ) {
    super(`${adapter} violated ${invariant}.`)
    this.name = 'AdapterConformanceFailure'
  }
}

function requireInvariant(
  adapter: AdapterConformanceFailure['adapter'],
  invariant: string,
  condition: boolean,
  actual: unknown,
) {
  return condition
    ? Effect.void
    : Effect.fail(new AdapterConformanceFailure(adapter, invariant, actual))
}

export function eventLogConformance<TCreateError, TRequirements>(
  createService: Effect.Effect<EventLogService, TCreateError, TRequirements>,
) {
  return Effect.gen(function* () {
    const service = yield* createService
    const first = yield* service.append(
      [
        { type: 'first-recorded', payload: { value: 1 }, keys: {} },
        { type: 'second-recorded', payload: { value: 2 }, keys: {} },
      ],
      {
        expectedVersion: 0,
        idempotencyKey: 'event-log-conformance',
        fingerprint: 'v2:event-log-conformance',
      },
    )
    yield* requireInvariant(
      'event-log',
      'strict safe-integer global order',
      first.version === 2 &&
        first.events[0]?.order === 1 &&
        first.events[1]?.order === 2,
      first,
    )
    yield* requireInvariant(
      'event-log',
      'persisted Events carry type, payload, metadata and keys only',
      first.events.every(
        (event) =>
          Object.keys(event).sort().join(',') ===
            'id,keys,order,payload,recordedAt,type' &&
          Object.keys(event.keys).length === 0,
      ),
      first.events,
    )
    const duplicate = yield* service.append(
      [
        { type: 'first-recorded', payload: { value: 1 }, keys: {} },
        { type: 'second-recorded', payload: { value: 2 }, keys: {} },
      ],
      {
        expectedVersion: 0,
        idempotencyKey: 'event-log-conformance',
        fingerprint: 'v2:event-log-conformance',
      },
    )
    yield* requireInvariant(
      'event-log',
      'durable idempotent receipt',
      duplicate.duplicate &&
        duplicate.version === first.version &&
        duplicate.committedAt === first.committedAt,
      duplicate,
    )
    const changed = yield* service.append(
      [{ type: 'first-recorded', payload: { value: 99 }, keys: {} }],
      {
        idempotencyKey: 'event-log-conformance',
        fingerprint: 'v2:changed-payload',
      },
    )
    const versionAfterChanged = yield* service.currentVersion
    yield* requireInvariant(
      'event-log',
      'first commit wins for a reused key with its stored fingerprint',
      changed.duplicate &&
        changed.version === first.version &&
        changed.events.length === 2 &&
        changed.events[0]?.order === 1 &&
        changed.fingerprint === 'v2:event-log-conformance' &&
        versionAfterChanged === first.version,
      { changed, versionAfterChanged },
    )
    const found = yield* service.findCommit('event-log-conformance')
    yield* requireInvariant(
      'event-log',
      'stored commit lookup keeps the first fingerprint',
      found?.version === first.version &&
        found.fingerprint === 'v2:event-log-conformance',
      found,
    )
    const queried = yield* service.query(1, ['second-recorded'])
    yield* requireInvariant(
      'event-log',
      'ordered filtered query',
      queried.length === 1 && queried[0]?.order === 2,
      queried,
    )
    const second = yield* service.append([
      { type: 'third-recorded', payload: { value: 3 }, keys: {} },
    ])
    const commits = yield* service.commitsAfter(0)
    yield* requireInvariant(
      'event-log',
      'all commit boundaries survive without idempotency keys',
      commits.length === 2 &&
        commits[0]?.version === first.version &&
        commits[1]?.version === second.version &&
        Number.isFinite(Date.parse(commits[1]?.committedAt ?? '')),
      commits,
    )

    // Keyed Events: `item` and `list` are separate ID spaces, so the same
    // value under another name is another key.
    const keyed = yield* service.append([
      {
        type: 'item-recorded',
        payload: { item: 'a', list: 'l' },
        keys: { item: 'a', list: 'l' },
      },
      {
        type: 'item-recorded',
        payload: { item: 'b', list: 'a' },
        keys: { item: 'b', list: 'a' },
      },
      { type: 'list-recorded', payload: { list: 'l' }, keys: { list: 'l' } },
    ])
    yield* requireInvariant(
      'event-log',
      'a keyed append stores its Events like any other',
      keyed.version === 6 &&
        keyed.events.map((event) => event.order).join(',') === '4,5,6',
      keyed,
    )
    // The keys stored with each Event come back with it from every read.
    const keysOf = (events: readonly PersistedEvent[]) =>
      events.map((event) => JSON.stringify(sortedKeys(event.keys))).join(' ')
    const storedKeys =
      '{"item":"a","list":"l"} {"item":"b","list":"a"} {"list":"l"}'
    const queriedKeys = yield* service.query(3, [
      'item-recorded',
      'list-recorded',
    ])
    const committedKeys = yield* service.commitsAfter(3)
    yield* requireInvariant(
      'event-log',
      'every read returns each Event with the keys stored with it',
      keysOf(keyed.events) === storedKeys &&
        keysOf(queriedKeys) === storedKeys &&
        committedKeys.length === 1 &&
        keysOf(committedKeys[0]?.events ?? []) === storedKeys &&
        (yield* service.query(0, ['first-recorded'])).every(
          (event) => Object.keys(event.keys).length === 0,
        ),
      { keyed, queriedKeys, committedKeys },
    )

    yield* pagedReadConformance(service)

    const capabilities = service.capabilities
    yield* requireInvariant(
      'event-log',
      'declares its capabilities',
      typeof capabilities?.scopedAppend === 'boolean' &&
        typeof capabilities.keyedRead === 'boolean',
      capabilities,
    )
    const isStale = (exit: Exit.Exit<unknown, EventLogFailure>) =>
      Exit.isFailure(exit) &&
      exit.cause.reasons.some(
        (reason) =>
          Cause.isFailReason(reason) &&
          reason.error.operation === 'append' &&
          reason.error.cause instanceof SpecterVersionConflictError,
      )
    const failed = (
      exit: Exit.Exit<unknown, EventLogFailure>,
      operation: EventLogFailure['operation'],
    ) =>
      Exit.isFailure(exit) &&
      exit.cause.reasons.some(
        (reason) =>
          Cause.isFailReason(reason) && reason.error.operation === operation,
      )

    if (capabilities.scopedAppend) {
      yield* scopedAppendConformance(service, isStale)
    } else {
      // Without the capability, a scoped append must be refused, never
      // appended without its check.
      const refused = yield* Effect.exit(
        service.append([{ type: 'item-noted', payload: {}, keys: {} }], {
          expectedUnchanged: { afterOrder: 0, eventTypes: ['first-recorded'] },
        }),
      )
      const versionAfterRefused = yield* service.currentVersion
      yield* requireInvariant(
        'event-log',
        'an Event Log without scopedAppend refuses expectedUnchanged',
        failed(refused, 'append') && versionAfterRefused === 6,
        { refused, versionAfterRefused },
      )
    }

    if (capabilities.keyedRead) {
      // A keyed read: the Events carrying one key, in order, paged.
      const byList = yield* service.readKey({ name: 'list', value: 'l' })
      const byListPage = yield* service.readKey(
        { name: 'list', value: 'l' },
        { afterOrder: 4, limit: 1 },
      )
      const byItem = yield* service.readKey(
        { name: 'item', value: 'a' },
        { limit: 10 },
      )
      const byOtherName = yield* service.readKey({
        name: 'project',
        value: 'l',
      })
      yield* requireInvariant(
        'event-log',
        'a keyed read returns the Events carrying that key under that name, ordered and paged',
        byList.map((event) => event.order).join(',') === '4,6' &&
          byList[0]?.type === 'item-recorded' &&
          (byList[0]?.payload as { readonly item?: unknown }).item === 'a' &&
          keysOf(byList) === '{"item":"a","list":"l"} {"list":"l"}' &&
          byListPage.map((event) => event.order).join(',') === '6' &&
          byItem.map((event) => event.order).join(',') === '4' &&
          byOtherName.length === 0,
        { byList, byListPage, byItem, byOtherName },
      )
    } else {
      const refused = yield* Effect.exit(
        service.readKey({ name: 'list', value: 'l' }),
      )
      yield* requireInvariant(
        'event-log',
        'an Event Log without keyedRead refuses readKey',
        failed(refused, 'readKey'),
        refused,
      )
    }

    yield* hostContextConformance(service, failed)
  })
}

/**
 * An Event the host gave an ID and a time is stored under them, an Event it
 * gave none takes the Event Log's, and an ID already in the log fails the
 * append. Metadata reaches the adapter and is not part of the Event.
 */
function hostContextConformance(
  service: EventLogService,
  failed: (
    exit: Exit.Exit<unknown, EventLogFailure>,
    operation: EventLogFailure['operation'],
  ) => boolean,
) {
  return Effect.gen(function* () {
    const recordedAt = '2026-01-02T03:04:05.006Z'
    const before = yield* service.currentVersion
    const hosted = yield* service.append([
      {
        type: 'host-recorded',
        payload: { value: 1 },
        keys: {},
        id: 'host-event-1',
        recordedAt,
        metadata: { location: 'host' },
      },
      { type: 'host-recorded', payload: { value: 2 }, keys: {} },
    ])
    const read = yield* service.query(before, ['host-recorded'])
    const generated = read[1]
    yield* requireInvariant(
      'event-log',
      "an Event is stored under the host's ID and time, or the Event Log's",
      hosted.events[0]?.id === 'host-event-1' &&
        hosted.events[0]?.recordedAt === recordedAt &&
        read[0]?.id === 'host-event-1' &&
        read[0]?.recordedAt === recordedAt &&
        !('metadata' in (read[0] ?? {})) &&
        generated !== undefined &&
        generated.id !== 'host-event-1' &&
        generated.id === hosted.events[1]?.id &&
        Number.isFinite(Date.parse(generated.recordedAt)),
      { hosted, read },
    )
    const reused = yield* Effect.exit(
      service.append([
        {
          type: 'host-recorded',
          payload: { value: 3 },
          keys: {},
          id: 'host-event-1',
        },
      ]),
    )
    const after = yield* service.currentVersion
    yield* requireInvariant(
      'event-log',
      'an Event ID already in the log fails the append',
      failed(reused, 'append') && after === hosted.version,
      { reused, after },
    )
  })
}

/**
 * Reads come in pages: `query` returns at most `limit` Events, and
 * `commitsAfter` at most `limit` complete commits, each the first after
 * where the read starts. Runs on a log holding the Events
 * `eventLogConformance` appended, at version 6, in commits 2, 3 and 6.
 */
function pagedReadConformance(service: EventLogService) {
  return Effect.gen(function* () {
    const types = [
      'first-recorded',
      'second-recorded',
      'third-recorded',
      'item-recorded',
      'list-recorded',
    ]
    const orders = (events: readonly PersistedEvent[]) =>
      events.map((event) => event.order).join(',')
    const firstPage = yield* service.query(0, types, { limit: 2 })
    const secondPage = yield* service.query(2, types, { limit: 2 })
    const filteredPage = yield* service.query(4, ['item-recorded'], {
      limit: 1,
    })
    const lastPage = yield* service.query(4, types, { limit: 5 })
    const pastEnd = yield* service.query(6, types, { limit: 2 })
    yield* requireInvariant(
      'event-log',
      'query returns at most limit Events, the first after its order',
      orders(firstPage) === '1,2' &&
        orders(secondPage) === '3,4' &&
        orders(filteredPage) === '5' &&
        orders(lastPage) === '5,6' &&
        pastEnd.length === 0,
      { firstPage, secondPage, filteredPage, lastPage, pastEnd },
    )
    const versions = (commits: readonly { readonly version: number }[]) =>
      commits.map((commit) => commit.version).join(',')
    const firstCommits = yield* service.commitsAfter(0, { limit: 1 })
    const nextCommits = yield* service.commitsAfter(2, { limit: 1 })
    const lastCommits = yield* service.commitsAfter(3, { limit: 2 })
    const noCommits = yield* service.commitsAfter(6, { limit: 1 })
    yield* requireInvariant(
      'event-log',
      'commitsAfter returns at most limit whole commits, the first after its version',
      versions(firstCommits) === '2' &&
        firstCommits[0]?.events.length === 2 &&
        versions(nextCommits) === '3' &&
        versions(lastCommits) === '6' &&
        orders(lastCommits[0]?.events ?? []) === '4,5,6' &&
        noCommits.length === 0,
      { firstCommits, nextCommits, lastCommits, noCommits },
    )
  })
}

/** Keys by name in a stable order, to compare them as text. */
function sortedKeys(keys: Readonly<Record<string, string>>) {
  return Object.fromEntries(
    Object.entries(keys).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    ),
  )
}

/**
 * A compare-and-swap scoped to what a decision read: only later Events of its
 * types, narrowed to those carrying one of its keys, make the append stale.
 * The keys are the ones stored with each Event. Runs on a log holding the
 * Events `eventLogConformance` appended, at version 6.
 */
function scopedAppendConformance(
  service: EventLogService,
  isStale: (exit: Exit.Exit<unknown, EventLogFailure>) => boolean,
) {
  return Effect.gen(function* () {
    const unrelated = yield* service.append(
      [{ type: 'first-recorded', payload: { value: 4 }, keys: {} }],
      {
        expectedUnchanged: { afterOrder: 1, eventTypes: ['first-recorded'] },
      },
    )
    yield* requireInvariant(
      'event-log',
      'a scoped append ignores later Events of other types',
      !unrelated.duplicate && unrelated.version === 7,
      unrelated,
    )
    const staleByType = yield* Effect.exit(
      service.append(
        [{ type: 'third-recorded', payload: { value: 5 }, keys: {} }],
        {
          expectedUnchanged: { afterOrder: 2, eventTypes: ['third-recorded'] },
        },
      ),
    )
    yield* requireInvariant(
      'event-log',
      'a scoped append is stale for a later Event of its types',
      isStale(staleByType),
      staleByType,
    )

    const scoped = (keys: Readonly<Record<string, readonly string[]>>) =>
      Effect.exit(
        service.append([{ type: 'item-noted', payload: {}, keys: {} }], {
          expectedUnchanged: {
            afterOrder: 3,
            eventTypes: ['item-recorded', 'list-recorded'],
            keys,
          },
        }),
      )
    const staleByKey = yield* scoped({ item: ['a'] })
    const staleByOtherName = yield* scoped({ list: ['a'] })
    const staleByAnyName = yield* scoped({ item: ['c'], list: ['l'] })
    const unmatchedKey = yield* scoped({ item: ['c'] })
    const unmatchedName = yield* scoped({ project: ['a'] })
    const noValues = yield* scoped({ item: [] })
    const versionAfterKeyed = yield* service.currentVersion
    yield* requireInvariant(
      'event-log',
      'a keyed append is stale only for a later Event carrying one of its keys under that name',
      isStale(staleByKey) &&
        isStale(staleByOtherName) &&
        isStale(staleByAnyName) &&
        Exit.isSuccess(unmatchedKey) &&
        Exit.isSuccess(unmatchedName) &&
        Exit.isSuccess(noValues) &&
        versionAfterKeyed === 10,
      {
        staleByKey,
        staleByOtherName,
        staleByAnyName,
        unmatchedKey,
        unmatchedName,
        noValues,
        versionAfterKeyed,
      },
    )
    const staleByKeyAndType = yield* Effect.exit(
      service.append([{ type: 'item-noted', payload: {}, keys: {} }], {
        expectedUnchanged: {
          afterOrder: 3,
          eventTypes: ['list-recorded'],
          keys: { item: ['a'] },
        },
      }),
    )
    yield* requireInvariant(
      'event-log',
      'a keyed append still needs a later Event of its types',
      Exit.isSuccess(staleByKeyAndType),
      staleByKeyAndType,
    )

    const scopedDuplicate = yield* service.append(
      [{ type: 'first-recorded', payload: { value: 1 }, keys: {} }],
      {
        expectedUnchanged: { afterOrder: 0, eventTypes: ['first-recorded'] },
        idempotencyKey: 'event-log-conformance',
        fingerprint: 'v2:event-log-conformance',
      },
    )
    yield* requireInvariant(
      'event-log',
      'a known idempotency key returns its commit before a scoped check',
      scopedDuplicate.duplicate && scopedDuplicate.version === 2,
      scopedDuplicate,
    )
  })
}

export type SliceStoreConformanceOptions<
  TWrite,
  TRead,
  TValue,
  TStoreError,
  TCreateError,
  TRequirements,
> = {
  readonly createService: Effect.Effect<
    SliceStoreService<TRead, TWrite, TStoreError>,
    TCreateError,
    TRequirements
  >
  readonly write: (state: TWrite, value: TValue) => Promise<void>
  readonly read: (state: TRead) => Promise<TValue>
  readonly value: TValue
}

export function sliceStoreConformance<
  TWrite,
  TRead,
  TValue,
  TStoreError,
  TCreateError,
  TRequirements,
>(
  options: SliceStoreConformanceOptions<
    TWrite,
    TRead,
    TValue,
    TStoreError,
    TCreateError,
    TRequirements
  >,
) {
  return Effect.gen(function* () {
    const service = yield* options.createService
    const first: SliceStoreSlice = {
      name: 'sharedTagFirstSlice',
      version: 'conformance-1',
    }
    const second: SliceStoreSlice = {
      name: 'sharedTagSecondSlice',
      version: 'conformance-1',
    }
    const valueAndCursor = (slice: SliceStoreSlice) =>
      service.read(slice, (read, cursor) =>
        Effect.map(
          Effect.promise(() => options.read(read)),
          (value) => ({ value, cursor }),
        ),
      )
    const cursorOf = (slice: SliceStoreSlice) =>
      service.read(slice, (_read, cursor) => Effect.succeed(cursor))

    yield* service.transaction(first, (write, _read, cursor, publishCursor) =>
      Effect.gen(function* () {
        yield* requireInvariant(
          'slice-store',
          'fresh cursor',
          cursor === 0,
          cursor,
        )
        yield* Effect.promise(() => options.write(write, options.value))
        yield* publishCursor(7)
      }),
    )
    const published = yield* valueAndCursor(first)
    yield* requireInvariant(
      'slice-store',
      'atomic apply and cursor publication',
      published.cursor === 7 && Object.is(published.value, options.value),
      published,
    )
    const secondCursor = yield* cursorOf(second)
    yield* requireInvariant(
      'slice-store',
      'independent cursors for shared Tag',
      secondCursor === 0,
      secondCursor,
    )

    yield* Effect.result(
      service.transaction(first, (write, _read, _cursor, publishCursor) =>
        Effect.gen(function* () {
          yield* Effect.promise(() => options.write(write, options.value))
          yield* publishCursor(9)
          return yield* Effect.fail('rollback-conformance')
        }),
      ),
    )
    const afterRollback = yield* valueAndCursor(first)
    yield* requireInvariant(
      'slice-store',
      'rollback keeps prior visible cursor',
      afterRollback.cursor === 7,
      afterRollback,
    )

    let callbacks = 0
    const observedCursors: number[] = []
    const concurrentTransaction = service.transaction(
      first,
      (_write, _read, cursor, publishCursor) =>
        Effect.gen(function* () {
          callbacks += 1
          observedCursors.push(cursor)
          yield* Effect.sleep('1 millis')
          yield* publishCursor(cursor + 1)
        }),
    )
    yield* Effect.all([concurrentTransaction, concurrentTransaction], {
      concurrency: 'unbounded',
    })
    const finalCursor = yield* cursorOf(first)
    yield* requireInvariant(
      'slice-store',
      'adapter locks before one-shot transaction callbacks',
      callbacks === 2 &&
        observedCursors[0] === 7 &&
        observedCursors[1] === 8 &&
        finalCursor === 9,
      { callbacks, observedCursors, finalCursor },
    )

    // A Slice of another version, such as after its State changed shape,
    // starts empty: it folds the log again from its start.
    const upgraded: SliceStoreSlice = { ...first, version: 'conformance-2' }
    const upgradedCursor = yield* cursorOf(upgraded)
    yield* service.transaction(
      upgraded,
      (write, _read, cursor, publishCursor) =>
        Effect.gen(function* () {
          yield* requireInvariant(
            'slice-store',
            'a Slice of another version starts at cursor 0',
            cursor === 0,
            cursor,
          )
          yield* Effect.promise(() => options.write(write, options.value))
          yield* publishCursor(3)
        }),
    )
    const refolded = yield* valueAndCursor(upgraded)
    yield* requireInvariant(
      'slice-store',
      'State kept under another version is never read, and a Slice of a new version publishes from 0',
      upgradedCursor === 0 &&
        refolded.cursor === 3 &&
        Object.is(refolded.value, options.value),
      { upgradedCursor, refolded },
    )
  })
}

/**
 * A snapshot store returns what it saved, one snapshot per Slice: a save
 * replaces a Slice's snapshot unless the saved one has the same version and
 * a later cursor, and a snapshot of another version always replaces it.
 * State round-trips as JSON. Each call needs an empty store.
 */
export function sliceSnapshotStoreConformance<TCreateError, TRequirements>(
  createStore: Effect.Effect<SliceSnapshotStore, TCreateError, TRequirements>,
) {
  return Effect.gen(function* () {
    const store = yield* createStore
    const empty = yield* store.load
    yield* requireInvariant(
      'slice-snapshot-store',
      'an empty store loads nothing',
      empty.length === 0,
      empty,
    )
    const todos: SliceSnapshot = {
      slice: 'todos',
      version: 'sha256:a/1',
      state: { items: [{ id: 't1', done: false }], names: ['first'] },
      cursor: 4,
    }
    const counts: SliceSnapshot = {
      slice: 'counts',
      version: 'sha256:b/1',
      state: { total: 2 },
      cursor: 7,
    }
    yield* store.save([todos, counts])
    const loaded = bySlice(yield* store.load)
    yield* requireInvariant(
      'slice-snapshot-store',
      'loads each saved snapshot with its version, State and cursor',
      loaded.size === 2 &&
        sameSnapshot(loaded.get('todos'), todos) &&
        sameSnapshot(loaded.get('counts'), counts),
      [...loaded.values()],
    )

    const behind = { ...todos, state: { items: [] }, cursor: 3 }
    const ahead = { ...counts, state: { total: 5 }, cursor: 9 }
    yield* store.save([behind, ahead])
    const moved = bySlice(yield* store.load)
    yield* requireInvariant(
      'slice-snapshot-store',
      'a save never moves a Slice of the same version back',
      sameSnapshot(moved.get('todos'), todos) &&
        sameSnapshot(moved.get('counts'), ahead),
      [...moved.values()],
    )

    const reshaped = {
      ...todos,
      version: 'sha256:a/2',
      state: { open: [] },
      cursor: 2,
    }
    yield* store.save([reshaped])
    const replaced = bySlice(yield* store.load)
    yield* requireInvariant(
      'slice-snapshot-store',
      "a snapshot of another version replaces its Slice's snapshot, whatever its cursor",
      replaced.size === 2 && sameSnapshot(replaced.get('todos'), reshaped),
      [...replaced.values()],
    )
  })
}

function bySlice(snapshots: readonly SliceSnapshot[]) {
  return new Map(snapshots.map((snapshot) => [snapshot.slice, snapshot]))
}

function sameSnapshot(
  actual: SliceSnapshot | undefined,
  expected: SliceSnapshot,
) {
  return (
    actual !== undefined &&
    actual.slice === expected.slice &&
    actual.version === expected.version &&
    actual.cursor === expected.cursor &&
    valuesEqual(actual.state, expected.state)
  )
}

/** Thin Vitest runners. Semantics live in Effect programs above. */
export function testEventLogService(
  name: string,
  createService: () => EventLogService | Promise<EventLogService>,
) {
  describe(`${name} Event Log`, () => {
    it('conforms', async () => {
      await Effect.runPromise(
        eventLogConformance(
          Effect.promise(() => Promise.resolve(createService())),
        ),
      )
    })
  })
}

export function testSliceSnapshotStore(
  name: string,
  createStore: () => SliceSnapshotStore | Promise<SliceSnapshotStore>,
) {
  describe(`${name} Slice snapshot store`, () => {
    it('conforms', async () => {
      await Effect.runPromise(
        sliceSnapshotStoreConformance(
          Effect.promise(() => Promise.resolve(createStore())),
        ),
      )
    })
  })
}

export function testSliceStoreService<TWrite, TRead, TValue>(
  name: string,
  options: Omit<
    SliceStoreConformanceOptions<TWrite, TRead, TValue, unknown, never, never>,
    'createService'
  > & {
    readonly createService: () =>
      | SliceStoreService<TRead, TWrite, unknown>
      | Promise<SliceStoreService<TRead, TWrite, unknown>>
  },
) {
  describe(`${name} Slice Store`, () => {
    it('conforms', async () => {
      await Effect.runPromise(
        sliceStoreConformance({
          ...options,
          createService: Effect.promise(() =>
            Promise.resolve(options.createService()),
          ),
        }),
      )
    })
  })
}

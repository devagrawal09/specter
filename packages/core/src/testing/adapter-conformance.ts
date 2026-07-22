import { Effect } from 'effect'
import { describe, it } from 'vitest'

import type { EventLogService, SliceStoreService } from '../adapters'

export class AdapterConformanceFailure extends Error {
  readonly _tag = 'AdapterConformanceFailure' as const

  constructor(
    readonly adapter: 'event-log' | 'slice-store',
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
        { type: 'first-recorded', payload: { value: 1 } },
        { type: 'second-recorded', payload: { value: 2 } },
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
    const duplicate = yield* service.append(first.events, {
      expectedVersion: 0,
      idempotencyKey: 'event-log-conformance',
      fingerprint: 'v2:event-log-conformance',
    })
    yield* requireInvariant(
      'event-log',
      'durable idempotent receipt',
      duplicate.duplicate &&
        duplicate.version === first.version &&
        duplicate.committedAt === first.committedAt,
      duplicate,
    )
    const queried = yield* service.query(1, ['second-recorded'])
    yield* requireInvariant(
      'event-log',
      'ordered filtered query',
      queried.length === 1 && queried[0]?.order === 2,
      queried,
    )
    const second = yield* service.append([
      { type: 'third-recorded', payload: { value: 3 } },
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
    yield* service.transaction(
      'sharedTagFirstSlice',
      (write, _read, cursor, publishCursor) =>
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
    const published = yield* service.read(
      'sharedTagFirstSlice',
      (read, cursor) =>
        Effect.map(
          Effect.promise(() => options.read(read)),
          (value) => ({
            value,
            cursor,
          }),
        ),
    )
    yield* requireInvariant(
      'slice-store',
      'atomic apply and cursor publication',
      published.cursor === 7 && Object.is(published.value, options.value),
      published,
    )
    const secondCursor = yield* service.read(
      'sharedTagSecondSlice',
      (_read, cursor) => Effect.succeed(cursor),
    )
    yield* requireInvariant(
      'slice-store',
      'independent cursors for shared Tag',
      secondCursor === 0,
      secondCursor,
    )

    yield* Effect.result(
      service.transaction(
        'sharedTagFirstSlice',
        (write, _read, _cursor, publishCursor) =>
          Effect.gen(function* () {
            yield* Effect.promise(() => options.write(write, options.value))
            yield* publishCursor(9)
            return yield* Effect.fail('rollback-conformance')
          }),
      ),
    )
    const afterRollback = yield* service.read(
      'sharedTagFirstSlice',
      (read, cursor) =>
        Effect.map(
          Effect.promise(() => options.read(read)),
          (value) => ({
            value,
            cursor,
          }),
        ),
    )
    yield* requireInvariant(
      'slice-store',
      'rollback keeps prior visible cursor',
      afterRollback.cursor === 7,
      afterRollback,
    )

    let callbacks = 0
    const observedCursors: number[] = []
    const concurrentTransaction = service.transaction(
      'sharedTagFirstSlice',
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
    const finalCursor = yield* service.read(
      'sharedTagFirstSlice',
      (_read, cursor) => Effect.succeed(cursor),
    )
    yield* requireInvariant(
      'slice-store',
      'adapter locks before one-shot transaction callbacks',
      callbacks === 2 &&
        observedCursors[0] === 7 &&
        observedCursors[1] === 8 &&
        finalCursor === 9,
      { callbacks, observedCursors, finalCursor },
    )
  })
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

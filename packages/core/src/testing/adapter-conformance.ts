import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import type {
  EventLogService,
  ReactionSchedulerService,
  SliceStoreService,
} from '../adapters'

export class AdapterConformanceFailure extends Error {
  readonly _tag = 'AdapterConformanceFailure' as const

  constructor(
    readonly adapter: 'event-log' | 'slice-store' | 'reaction-scheduler',
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
      duplicate.duplicate && duplicate.version === first.version,
      duplicate,
    )
    const queried = yield* service.query(1, ['second-recorded'])
    yield* requireInvariant(
      'event-log',
      'ordered filtered query',
      queried.length === 1 && queried[0]?.order === 2,
      queried,
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
  })
}

export function reactionSchedulerConformance<TCreateError, TRequirements>(
  createService: Effect.Effect<
    ReactionSchedulerService,
    TCreateError,
    TRequirements
  >,
) {
  return Effect.gen(function* () {
    const service = yield* createService
    const contexts: unknown[] = []
    const completion = yield* service.schedule(11, (context) =>
      Effect.sync(() => {
        contexts.push(context)
      }),
    )
    yield* completion
    const context = contexts[0] as
      | { throughOrder?: number; deliveryId?: string; scheduledAt?: string }
      | undefined
    yield* requireInvariant(
      'reaction-scheduler',
      'eager native delivery with stable metadata',
      context?.throughOrder === 11 &&
        typeof context.deliveryId === 'string' &&
        typeof context.scheduledAt === 'string',
      context,
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

export function testReactionSchedulerService(
  name: string,
  createService: () =>
    | ReactionSchedulerService
    | Promise<ReactionSchedulerService>,
) {
  describe(`${name} Reaction scheduler`, () => {
    it('conforms', async () => {
      await Effect.runPromise(
        reactionSchedulerConformance(
          Effect.promise(() => Promise.resolve(createService())),
        ),
      )
      expect(true).toBe(true)
    })
  })
}

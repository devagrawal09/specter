import type { StandardSchemaV1 } from '@standard-schema/spec'
import { Context, Effect, Fiber, Layer, Semaphore, Stream } from 'effect'
import { describe, expect, it } from 'vitest'

import {
  EventLog,
  EventLogFailure,
  ReactionScheduler,
  ReactionSchedulerFailure,
  type EventLogService,
  type ReactionSchedulerService,
  type SliceStoreService,
  SpecterIdempotencyConflictError,
  SpecterInvalidCommandOptionsError,
  SpecterStoreConfigurationError,
} from '..'
import { createEventDefinition, createSpecterApp } from '..'
import {
  createCommandSlice,
  createQuerySlice,
  createReactionSlice,
  event,
} from '../spec-entry'
import { createSpecterAppLayer, SpecterRuntime } from './runtime'

type State = { values: number[]; published?: boolean }
class ValuesStore extends Context.Service<
  ValuesStore,
  SliceStoreService<Readonly<State>, State>
>()('specter-test/ValuesStore') {}

const numberSchema: StandardSchemaV1<number> = {
  '~standard': {
    version: 1,
    vendor: 'specter-test',
    validate: (value) =>
      typeof value === 'number'
        ? { value }
        : { issues: [{ message: 'Expected number' }] },
  },
}

describe('Effect-native runtime', () => {
  it('catches up only Slices whose Store binding is eager', async () => {
    const valueRecorded = createEventDefinition('value-recorded', numberSchema)
    let transactions = 0
    const command = createCommandSlice('recordValue')
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
    const eagerValues = createQuerySlice('eagerValues')
      .description('Warms values during startup.')
      .scenarios({
        description: 'Reads one value.',
        given: [event('value-recorded', 1)],
        when: {},
        expect: [1],
      })
      .inputSchema<Record<string, never>>()
      .outputSchema<readonly number[]>()
      .store(ValuesStore, { eager: true })
      .apply(valueRecorded, async (applied, state) => {
        state.values.push(applied.payload)
      })
      .handle(async (_input, state) => state.values)
    const lazyValues = createQuerySlice('lazyValues')
      .description('Defers values until queried.')
      .scenarios({
        description: 'Reads one value.',
        given: [event('value-recorded', 1)],
        when: {},
        expect: [1],
      })
      .inputSchema<Record<string, never>>()
      .outputSchema<readonly number[]>()
      .store(ValuesStore)
      .apply(valueRecorded, async (applied, state) => {
        state.values.push(applied.payload)
      })
      .handle(async (_input, state) => state.values)
    const layer = createSpecterAppLayer({
      events: [valueRecorded],
      slices: [command, eagerValues, lazyValues],
    } as const).pipe(
      Layer.provide(
        Layer.mergeAll(
          storeLayer({
            onTransaction: (active) => {
              if (active) transactions += 1
            },
          }),
          eventLogLayer([{ type: 'value-recorded', payload: 1 }]),
          schedulerLayer(),
        ),
      ),
    )

    await Effect.runPromise(
      Effect.scoped(Effect.provide(Effect.service(SpecterRuntime), layer)),
    )
    expect(transactions).toBe(1)
  })

  it('fails startup for malformed dynamic Store service', async () => {
    const valueRecorded = createEventDefinition('value-recorded', numberSchema)
    const command = createCommandSlice('recordValue')
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
    const layer = createSpecterAppLayer({
      events: [valueRecorded],
      slices: [command],
    } as const).pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(ValuesStore, {} as never),
          eventLogLayer(),
          schedulerLayer(),
        ),
      ),
    )
    const result = await Effect.runPromise(
      Effect.result(
        Effect.scoped(Effect.provide(Effect.service(SpecterRuntime), layer)),
      ),
    )
    expect(result._tag).toBe('Failure')
    if (result._tag === 'Success') throw new Error('Expected startup failure')
    expect(result.failure).toBeInstanceOf(SpecterStoreConfigurationError)
  })

  it('commits catch-up before invoking read-only handler', async () => {
    const valueRecorded = createEventDefinition('value-recorded', numberSchema)
    let transactionActive = false
    const recordValue = createCommandSlice('recordValue')
      .description('Records one value.')
      .scenarios({
        description: 'Records one value.',
        given: [],
        when: 3,
        expect: [event('value-recorded', 3)],
      })
      .inputSchema<number>()
      .store(ValuesStore)
      .handle(async (value) => [valueRecorded.create(value)])
    const values = createQuerySlice('values')
      .description('Reads values.')
      .scenarios({
        description: 'Reads one value.',
        given: [event('value-recorded', 3)],
        when: {},
        expect: [3],
      })
      .inputSchema<Record<string, never>>()
      .outputSchema<readonly number[]>()
      .store(ValuesStore)
      .apply(valueRecorded, async (applied, state) => {
        state.values.push(applied.payload)
      })
      .handle(async (_input, state) => {
        expect(transactionActive).toBe(false)
        return state.values
      })
    const dependencies = Layer.mergeAll(
      storeLayer({ onTransaction: (active) => (transactionActive = active) }),
      eventLogLayer(),
      schedulerLayer(),
    )
    const layer = createSpecterAppLayer({
      events: [valueRecorded],
      slices: [recordValue, values],
    } as const).pipe(Layer.provide(dependencies))
    const program = Effect.gen(function* () {
      const app = yield* SpecterRuntime
      yield* app.command({ type: 'recordValue', payload: 3 })
      return yield* app.query({ type: 'values', payload: {} })
    })
    await expect(
      Effect.runPromise(Effect.scoped(Effect.provide(program, layer))),
    ).resolves.toEqual([3])
  })

  it('enqueues Reactions before Command returns and runs effect after Store commit', async () => {
    const valueRecorded = createEventDefinition('value-recorded', numberSchema)
    let transactionActive = false
    let scheduled = false
    let executed = false
    const recordValue = createCommandSlice('recordValue')
      .description('Records one value.')
      .scenarios({
        description: 'Records one value.',
        given: [],
        when: 5,
        expect: [event('value-recorded', 5)],
      })
      .inputSchema<number>()
      .store(ValuesStore)
      .handle(async (value) => [valueRecorded.create(value)])
    const reaction = createReactionSlice('publishValue')
      .description('Publishes latest value.')
      .scenarios({
        description: 'Publishes one value.',
        given: [event('value-recorded', 5)],
        expect: 5,
      })
      .outputSchema<number>()
      .plugin(() =>
        Effect.succeed((_value) =>
          Effect.sync(() => {
            expect(transactionActive).toBe(false)
            executed = true
          }),
        ),
      )
      .store(ValuesStore)
      .apply(valueRecorded, async (applied, state) => {
        state.values.push(applied.payload)
      })
      .handle(async (state) => state.values.at(-1))
    const layer = createSpecterAppLayer({
      events: [valueRecorded],
      slices: [recordValue, reaction],
    } as const).pipe(
      Layer.provide(
        Layer.mergeAll(
          storeLayer({
            onTransaction: (active) => (transactionActive = active),
          }),
          eventLogLayer(),
          schedulerLayer(() => (scheduled = true)),
        ),
      ),
    )
    const program = Effect.gen(function* () {
      const app = yield* SpecterRuntime
      const execution = yield* app.command({ type: 'recordValue', payload: 5 })
      expect(scheduled).toBe(true)
      expect(executed).toBe(false)
      yield* execution.reactions
    })
    await Effect.runPromise(Effect.scoped(Effect.provide(program, layer)))
    expect(executed).toBe(true)
  })

  it('keeps committed Events when scheduler acceptance fails', async () => {
    const valueRecorded = createEventDefinition('value-recorded', numberSchema)
    let appendCount = 0
    const command = createCommandSlice('recordValue')
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
    const reaction = createReactionSlice('publishValue')
      .description('Publishes latest value.')
      .scenarios({
        description: 'Publishes one value.',
        given: [event('value-recorded', 1)],
        expect: 1,
      })
      .outputSchema<number>()
      .plugin(() => Effect.succeed(() => Effect.void))
      .store(ValuesStore)
      .apply(valueRecorded, async (applied, state) => {
        state.values.push(applied.payload)
      })
      .handle(async (state) => state.values.at(-1))
    const failingScheduler: ReactionSchedulerService = {
      schedule: () =>
        Effect.fail(
          new ReactionSchedulerFailure('schedule', new Error('outbox down')),
        ),
      recover: () => Effect.void,
    }
    const layer = createSpecterAppLayer({
      events: [valueRecorded],
      slices: [command, reaction],
    } as const).pipe(
      Layer.provide(
        Layer.mergeAll(
          storeLayer(),
          eventLogLayer([], () => {
            appendCount += 1
          }),
          Layer.succeed(ReactionScheduler, failingScheduler),
        ),
      ),
    )
    const result = await Effect.runPromise(
      Effect.result(
        Effect.scoped(
          Effect.provide(
            Effect.flatMap(SpecterRuntime, (app) =>
              app.command({ type: 'recordValue', payload: 1 }),
            ),
            layer,
          ),
        ),
      ),
    )
    expect(result._tag).toBe('Failure')
    expect(appendCount).toBe(1)
  })

  it('fails acquisition when scheduler recovery fails', async () => {
    const valueRecorded = createEventDefinition('value-recorded', numberSchema)
    const command = createCommandSlice('recordValue')
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
    const reaction = createReactionSlice('publishValue')
      .description('Publishes latest value.')
      .scenarios({
        description: 'Publishes one value.',
        given: [event('value-recorded', 1)],
        expect: 1,
      })
      .outputSchema<number>()
      .plugin(() => Effect.succeed(() => Effect.void))
      .store(ValuesStore)
      .apply(valueRecorded, async (applied, state) => {
        state.values.push(applied.payload)
      })
      .handle(async (state) => state.values.at(-1))
    const failingScheduler: ReactionSchedulerService = {
      schedule: () => Effect.succeed(Effect.void),
      recover: () =>
        Effect.fail(
          new ReactionSchedulerFailure('recover', new Error('recovery down')),
        ),
    }
    const layer = createSpecterAppLayer({
      events: [valueRecorded],
      slices: [command, reaction],
    } as const).pipe(
      Layer.provide(
        Layer.mergeAll(
          storeLayer(),
          eventLogLayer(),
          Layer.succeed(ReactionScheduler, failingScheduler),
        ),
      ),
    )
    const result = await Effect.runPromise(
      Effect.result(
        Effect.scoped(Effect.provide(Effect.service(SpecterRuntime), layer)),
      ),
    )
    expect(result._tag).toBe('Failure')
    if (result._tag === 'Failure') {
      expect(result.failure).toBeInstanceOf(ReactionSchedulerFailure)
    }
  })

  it('does not deadlock when a Reaction dispatches a Command', async () => {
    const valueRecorded = createEventDefinition('value-recorded', numberSchema)
    const valuePublished = createEventDefinition(
      'value-published',
      numberSchema,
    )
    let appendCount = 0
    let settleSecondPass: (() => void) | undefined
    const secondPass = new Promise<void>((resolve) => {
      settleSecondPass = resolve
    })
    const record = createCommandSlice('recordValue')
      .description('Records one value.')
      .scenarios({
        description: 'Records one value.',
        given: [],
        when: 5,
        expect: [event('value-recorded', 5)],
      })
      .inputSchema<number>()
      .store(ValuesStore)
      .handle(async (value) => [valueRecorded.create(value)])
    const publish = createCommandSlice('publishValue')
      .description('Marks one value published.')
      .scenarios({
        description: 'Publishes one value.',
        given: [],
        when: 5,
        expect: [event('value-published', 5)],
      })
      .inputSchema<number>()
      .store(ValuesStore)
      .handle(async (value) => [valuePublished.create(value)])
    const reaction = createReactionSlice('publishRecordedValue')
      .description('Dispatches publication Command.')
      .scenarios(
        {
          description: 'Publishes recorded value.',
          given: [event('value-recorded', 5)],
          expect: { type: 'publishValue', payload: 5 },
        },
        {
          description: 'Skips an already published value.',
          given: [event('value-published', 5)],
          expect: [],
        },
      )
      .outputSchema<{ type: 'publishValue'; payload: number }>()
      .store(ValuesStore)
      .apply(valueRecorded, async (applied, state) => {
        state.values.push(applied.payload)
        state.published = false
      })
      .apply(valuePublished, async (_applied, state) => {
        state.published = true
      })
      .handle(async (state) => {
        if (state.published) {
          settleSecondPass?.()
          return
        }
        const value = state.values.at(-1)
        return value === undefined
          ? undefined
          : { type: 'publishValue' as const, payload: value }
      })
    const layer = createSpecterAppLayer({
      events: [valueRecorded, valuePublished],
      slices: [record, publish, reaction],
    } as const).pipe(
      Layer.provide(
        Layer.mergeAll(
          storeLayer(),
          eventLogLayer([], () => {
            appendCount += 1
          }),
          serializedSchedulerLayer(),
        ),
      ),
    )
    const program = Effect.gen(function* () {
      const app = yield* SpecterRuntime
      const execution = yield* app.command({ type: 'recordValue', payload: 5 })
      yield* execution.reactions
      yield* Effect.promise(() => secondPass)
    }).pipe(Effect.timeout('1 second'))
    await Effect.runPromise(Effect.scoped(Effect.provide(program, layer)))
    expect(appendCount).toBe(2)
  })

  it('deduplicates same fingerprints across runtime restarts', async () => {
    const valueRecorded = createEventDefinition('value-recorded', numberSchema)
    const command = createCommandSlice('recordValue')
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
    const config = { events: [valueRecorded], slices: [command] } as const
    const eventLog = makeEventLogService()
    const runCommand = (payload: number) =>
      Effect.runPromise(
        Effect.scoped(
          Effect.provide(
            Effect.flatMap(SpecterRuntime, (app) =>
              app.command(
                { type: 'recordValue', payload },
                { idempotencyKey: 'request-1' },
              ),
            ),
            createSpecterAppLayer(config).pipe(
              Layer.provide(
                Layer.mergeAll(
                  storeLayer(),
                  Layer.succeed(EventLog, eventLog),
                  schedulerLayer(),
                ),
              ),
            ),
          ),
        ),
      )
    const first = await runCommand(1)
    const duplicate = await runCommand(1)
    expect(first.duplicate).toBe(false)
    expect(duplicate.duplicate).toBe(true)
    await expect(runCommand(2)).rejects.toBeInstanceOf(
      SpecterIdempotencyConflictError,
    )
  })

  it('rolls back partial apply State and cursor together', async () => {
    const firstRecorded = createEventDefinition('first-recorded', numberSchema)
    const secondRecorded = createEventDefinition(
      'second-recorded',
      numberSchema,
    )
    const command = createCommandSlice('recordFirst')
      .description('Records first value.')
      .scenarios({
        description: 'Records first value.',
        given: [],
        when: 1,
        expect: [event('first-recorded', 1)],
      })
      .inputSchema<number>()
      .store(ValuesStore)
      .handle(async (value) => [firstRecorded.create(value)])
    const query = createQuerySlice('values')
      .description('Reads applied values.')
      .scenarios({
        description: 'Reads both values.',
        given: [event('first-recorded', 1), event('second-recorded', 2)],
        when: {},
        expect: [1, 2],
      })
      .inputSchema<Record<string, never>>()
      .outputSchema<readonly number[]>()
      .store(ValuesStore)
      .apply(firstRecorded, async (applied, state) => {
        state.values.push(applied.payload)
      })
      .apply(secondRecorded, async (applied, state) => {
        state.values.push(applied.payload)
        throw new Error('second apply failed')
      })
      .handle(async (_input, state) => state.values)
    const store = makeStoreService()
    const layer = createSpecterAppLayer({
      events: [firstRecorded, secondRecorded],
      slices: [command, query],
    } as const).pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(ValuesStore, store),
          eventLogLayer([
            { type: 'first-recorded', payload: 1 },
            { type: 'second-recorded', payload: 2 },
          ]),
          schedulerLayer(),
        ),
      ),
    )
    const result = await Effect.runPromise(
      Effect.result(
        Effect.scoped(
          Effect.provide(
            Effect.flatMap(SpecterRuntime, (app) =>
              app.query({ type: 'values', payload: {} }),
            ),
            layer,
          ),
        ),
      ),
    )
    expect(result._tag).toBe('Failure')
    await expect(
      Effect.runPromise(
        store.read('values', (state, cursor) =>
          Effect.succeed({ state: [...state.values], cursor }),
        ),
      ),
    ).resolves.toEqual({ state: [], cursor: 0 })
  })

  it('publishes native Stream updates in order', async () => {
    const valueRecorded = createEventDefinition('value-recorded', numberSchema)
    const command = createCommandSlice('recordValue')
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
    const query = createQuerySlice('values')
      .description('Reads values.')
      .scenarios({
        description: 'Reads one value.',
        given: [event('value-recorded', 1)],
        when: {},
        expect: [1],
      })
      .inputSchema<Record<string, never>>()
      .outputSchema<readonly number[]>()
      .store(ValuesStore)
      .apply(valueRecorded, async (applied, state) => {
        state.values.push(applied.payload)
      })
      .handle(async (_input, state) => [...state.values])
    const layer = createSpecterAppLayer({
      events: [valueRecorded],
      slices: [command, query],
    } as const).pipe(
      Layer.provide(
        Layer.mergeAll(storeLayer(), eventLogLayer(), schedulerLayer()),
      ),
    )
    const program = Effect.gen(function* () {
      const app = yield* SpecterRuntime
      const fiber = yield* app
        .subscribe({ type: 'values', payload: {} })
        .pipe(Stream.take(2), Stream.runCollect, Effect.forkChild)
      yield* Effect.sleep('10 millis')
      yield* app.command({ type: 'recordValue', payload: 1 })
      return yield* Fiber.join(fiber)
    })
    const values = await Effect.runPromise(
      Effect.scoped(Effect.provide(program, layer)),
    )
    expect(Array.from(values)).toEqual([[], [1]])
  })

  it('preserves undefined Query values in native Streams', async () => {
    const valueRecorded = createEventDefinition('value-recorded', numberSchema)
    const command = createCommandSlice('recordValue')
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
    const query = createQuerySlice('missingValue')
      .description('Returns an absent value.')
      .scenarios({
        description: 'Returns no value.',
        given: [],
        when: {},
        expect: undefined,
      })
      .inputSchema<Record<string, never>>()
      .outputSchema<undefined>()
      .store(ValuesStore)
      .handle(async () => undefined)
    const layer = createSpecterAppLayer({
      events: [valueRecorded],
      slices: [command, query],
    } as const).pipe(
      Layer.provide(
        Layer.mergeAll(storeLayer(), eventLogLayer(), schedulerLayer()),
      ),
    )
    const values = await Effect.runPromise(
      Effect.scoped(
        Effect.provide(
          Effect.flatMap(SpecterRuntime, (app) =>
            app
              .subscribe({ type: 'missingValue', payload: {} })
              .pipe(Stream.take(1), Stream.runCollect),
          ),
          layer,
        ),
      ),
    )
    expect(Array.from(values)).toEqual([undefined])
  })

  it('handles subscription abort, close, fanout, and unrelated Events', async () => {
    const valueRecorded = createEventDefinition('value-recorded', numberSchema)
    const otherRecorded = createEventDefinition('other-recorded', numberSchema)
    let queryRuns = 0
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
    const recordOther = createCommandSlice('recordOther')
      .description('Records unrelated value.')
      .scenarios({
        description: 'Records unrelated value.',
        given: [],
        when: 9,
        expect: [event('other-recorded', 9)],
      })
      .inputSchema<number>()
      .store(ValuesStore)
      .handle(async (value) => [otherRecorded.create(value)])
    const values = createQuerySlice('values')
      .description('Reads values.')
      .scenarios({
        description: 'Reads one value.',
        given: [event('value-recorded', 1)],
        when: {},
        expect: [1],
      })
      .inputSchema<Record<string, never>>()
      .outputSchema<readonly number[]>()
      .store(ValuesStore)
      .apply(valueRecorded, async (applied, state) => {
        state.values.push(applied.payload)
      })
      .handle(async (_input, state) => {
        queryRuns += 1
        return [...state.values]
      })
    const app = await createSpecterApp(
      {
        events: [valueRecorded, otherRecorded],
        slices: [recordValue, recordOther, values],
      } as const,
      Layer.mergeAll(
        Layer.succeed(EventLog, makeEventLogService()),
        Layer.succeed(ValuesStore, makeStoreService()),
        schedulerLayer(),
      ),
    )
    const controller = new AbortController()
    const first = app
      .subscribe({ type: 'values', payload: {} }, { signal: controller.signal })
      [Symbol.asyncIterator]()
    const second = app
      .subscribe({ type: 'values', payload: {} })
      [Symbol.asyncIterator]()
    await expect(first.next()).resolves.toMatchObject({
      value: [],
      done: false,
    })
    await expect(second.next()).resolves.toMatchObject({
      value: [],
      done: false,
    })

    await app.command({ type: 'recordOther', payload: 9 })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(queryRuns).toBe(2)

    await app.command({ type: 'recordValue', payload: 1 })
    await expect(first.next()).resolves.toMatchObject({
      value: [1],
      done: false,
    })
    await expect(second.next()).resolves.toMatchObject({
      value: [1],
      done: false,
    })

    controller.abort()
    await expect(first.next()).resolves.toMatchObject({ done: true })
    const pendingClose = second.next()
    await app.close()
    await expect(pendingClose).resolves.toMatchObject({ done: true })
  })

  it('isolates Store instances between Promise apps', async () => {
    const valueRecorded = createEventDefinition('value-recorded', numberSchema)
    const command = createCommandSlice('recordValue')
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
    const query = createQuerySlice('values')
      .description('Reads values.')
      .scenarios({
        description: 'Reads one value.',
        given: [event('value-recorded', 1)],
        when: {},
        expect: [1],
      })
      .inputSchema<Record<string, never>>()
      .outputSchema<readonly number[]>()
      .store(ValuesStore)
      .apply(valueRecorded, async (applied, state) => {
        state.values.push(applied.payload)
      })
      .handle(async (_input, state) => [...state.values])
    const config = {
      events: [valueRecorded],
      slices: [command, query],
    } as const
    const dependencies = () =>
      Layer.mergeAll(
        Layer.succeed(EventLog, makeEventLogService()),
        Layer.succeed(ValuesStore, makeStoreService()),
        schedulerLayer(),
      )
    const first = await createSpecterApp(config, dependencies())
    const second = await createSpecterApp(config, dependencies())
    await first.command({ type: 'recordValue', payload: 1 })
    await expect(first.query({ type: 'values', payload: {} })).resolves.toEqual(
      [1],
    )
    await expect(
      second.query({ type: 'values', payload: {} }),
    ).resolves.toEqual([])
    await Promise.all([first.close(), second.close()])
  })

  it('rejects invalid expectedVersion before touching infrastructure', async () => {
    const valueRecorded = createEventDefinition('value-recorded', numberSchema)
    const command = createCommandSlice('recordValue')
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
    const layer = createSpecterAppLayer({
      events: [valueRecorded],
      slices: [command],
    } as const).pipe(
      Layer.provide(
        Layer.mergeAll(storeLayer(), eventLogLayer(), schedulerLayer()),
      ),
    )
    const result = await Effect.runPromise(
      Effect.result(
        Effect.scoped(
          Effect.provide(
            Effect.flatMap(SpecterRuntime, (app) =>
              app.command(
                { type: 'recordValue', payload: 1 },
                { expectedVersion: Number.MAX_SAFE_INTEGER + 1 },
              ),
            ),
            layer,
          ),
        ),
      ),
    )
    expect(result._tag).toBe('Failure')
    if (result._tag === 'Failure') {
      expect(result.failure).toBeInstanceOf(SpecterInvalidCommandOptionsError)
    }
  })
})

function storeLayer(
  options: { onTransaction?: (active: boolean) => void } = {},
) {
  return Layer.sync(ValuesStore, () =>
    ValuesStore.of(makeStoreService(options)),
  )
}

function makeStoreService(
  options: { onTransaction?: (active: boolean) => void } = {},
): SliceStoreService<Readonly<State>, State> {
  const entries = new Map<string, { state: State; cursor: number }>()
  const entry = (name: string) => {
    const existing = entries.get(name)
    if (existing) return existing
    const created = { state: { values: [] }, cursor: 0 }
    entries.set(name, created)
    return created
  }
  return {
    read: (name, run) => {
      const current = entry(name)
      return run(current.state, current.cursor)
    },
    transaction: (name, run) =>
      Effect.gen(function* () {
        const current = entry(name)
        const working = structuredClone(current)
        let publish = false
        options.onTransaction?.(true)
        const result = yield* run(
          working.state,
          () => working.state,
          working.cursor,
          (order) =>
            Effect.sync(() => {
              working.cursor = order
              publish = true
            }),
        ).pipe(
          Effect.ensuring(Effect.sync(() => options.onTransaction?.(false))),
        )
        if (publish) entries.set(name, working)
        return result
      }),
  }
}

function eventLogLayer(
  initial: ReadonlyArray<{ type: string; payload: unknown }> = [],
  onAppend?: () => void,
) {
  return Layer.succeed(EventLog, makeEventLogService(initial, onAppend))
}

function makeEventLogService(
  initial: ReadonlyArray<{ type: string; payload: unknown }> = [],
  onAppend?: () => void,
): EventLogService {
  const events: Array<{
    id: string
    order: number
    type: string
    payload: unknown
    recordedAt: string
  }> = initial.map((draft, index) => ({
    ...draft,
    id: `seed-${index + 1}`,
    order: index + 1,
    recordedAt: new Date(0).toISOString(),
  }))
  const commits = new Map<
    string,
    {
      events: typeof events
      version: number
      idempotencyKey: string
      fingerprint?: string
    }
  >()
  const service: EventLogService = {
    query: (after, types) =>
      Effect.succeed(
        events.filter(
          (item) => item.order > after && types.includes(item.type),
        ),
      ),
    currentVersion: Effect.sync(() => events.length),
    findCommit: (key) => Effect.succeed(commits.get(key)),
    append: (drafts, options = {}) =>
      Effect.try({
        try: () => {
          const existing = options.idempotencyKey
            ? commits.get(options.idempotencyKey)
            : undefined
          if (existing) {
            if (existing.fingerprint !== options.fingerprint) {
              throw new SpecterIdempotencyConflictError(
                options.idempotencyKey as string,
              )
            }
            return { ...existing, duplicate: true }
          }
          if (
            options.expectedVersion !== undefined &&
            options.expectedVersion !== events.length
          ) {
            throw new Error('version conflict')
          }
          const persisted = drafts.map((draft, index) => ({
            ...draft,
            id: `event-${events.length + index + 1}`,
            order: events.length + index + 1,
            recordedAt: new Date(0).toISOString(),
          }))
          events.push(...persisted)
          onAppend?.()
          const commit = {
            events: persisted,
            version: events.length,
            idempotencyKey: options.idempotencyKey as string,
            fingerprint: options.fingerprint,
          }
          if (options.idempotencyKey) {
            commits.set(options.idempotencyKey, commit)
          }
          return { ...commit, duplicate: false }
        },
        catch: (cause) => new EventLogFailure('append', cause),
      }),
  }
  return service
}

function schedulerLayer(onSchedule?: () => void) {
  const service: ReactionSchedulerService = {
    schedule: (throughOrder, execute) =>
      Effect.gen(function* () {
        onSchedule?.()
        const fiber = yield* Effect.forkDetach(
          execute({
            deliveryId: `delivery-${throughOrder}`,
            throughOrder,
            scheduledAt: new Date(0).toISOString(),
            attemptId: `delivery-${throughOrder}:attempt:1`,
            attemptNumber: 1,
          }),
          { startImmediately: true },
        )
        return Fiber.join(fiber)
      }),
    recover: () => Effect.void,
  }
  return Layer.succeed(ReactionScheduler, service)
}

function serializedSchedulerLayer() {
  return Layer.effect(
    ReactionScheduler,
    Effect.gen(function* () {
      const scope = yield* Effect.scope
      const semaphore = Semaphore.makeUnsafe(1)
      let sequence = 0
      return {
        schedule: (throughOrder, execute) =>
          Effect.gen(function* () {
            sequence += 1
            const id = `serialized-${sequence}`
            const fiber = yield* Effect.forkIn(
              semaphore.withPermit(
                execute({
                  deliveryId: id,
                  throughOrder,
                  scheduledAt: new Date(0).toISOString(),
                  attemptId: `${id}:attempt:1`,
                  attemptNumber: 1,
                }),
              ),
              scope,
            )
            return Fiber.join(fiber)
          }),
        recover: () => Effect.void,
      } satisfies ReactionSchedulerService
    }),
  )
}

import type { StandardSchemaV1 } from '@standard-schema/spec'
import { Context, Effect, Fiber, Layer, Stream } from 'effect'
import { describe, expect, it } from 'vitest'

import {
  EventLog,
  type EventLogCommit,
  EventLogFailure,
  type EventLogService,
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
} from '../definition'
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
      slices: { recordValue: command, eagerValues, lazyValues },
    } as const).pipe(
      Layer.provide(
        Layer.mergeAll(
          storeLayer({
            onTransaction: (active) => {
              if (active) transactions += 1
            },
          }),
          eventLogLayer([{ type: 'value-recorded', payload: 1 }]),
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
      slices: { recordValue: command },
    } as const).pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(ValuesStore, {} as never),
          eventLogLayer(),
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
    )
    const layer = createSpecterAppLayer({
      events: [valueRecorded],
      slices: { recordValue, values },
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

  it('starts Reactions before Command returns and runs Plugin inside Store transaction', async () => {
    const valueRecorded = createEventDefinition('value-recorded', numberSchema)
    let transactionActive = false
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
            expect(transactionActive).toBe(true)
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
      slices: { recordValue, publishValue: reaction },
    } as const).pipe(
      Layer.provide(
        Layer.mergeAll(
          storeLayer({
            onTransaction: (active) => (transactionActive = active),
          }),
          eventLogLayer(),
        ),
      ),
    )
    const program = Effect.gen(function* () {
      const app = yield* SpecterRuntime
      const execution = yield* app.command({ type: 'recordValue', payload: 5 })
      yield* execution.reactions
    })
    await Effect.runPromise(Effect.scoped(Effect.provide(program, layer)))
    expect(executed).toBe(true)
  })

  it('rolls back Reaction state and cursor, then retries with stable delivery ID', async () => {
    const valueRecorded = createEventDefinition('value-recorded', numberSchema)
    const store = makeStoreService()
    const eventLog = makeEventLogService()
    const deliveries: string[] = []
    let fail = true
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
      .description('Publishes every committed value.')
      .scenarios({
        description: 'Publishes one value.',
        given: [event('value-recorded', 1)],
        expect: 1,
      })
      .outputSchema<number>()
      .plugin(() =>
        Effect.succeed((_output, context) => {
          deliveries.push(context.deliveryId)
          return fail ? Effect.fail(new Error('provider down')) : Effect.void
        }),
      )
      .store(ValuesStore)
      .apply(valueRecorded, async (applied, state) => {
        state.values.push(applied.payload)
      })
      .handle(async (state) => state.values.at(-1))
    const config = {
      events: [valueRecorded],
      slices: { recordValue: command, publishValue: reaction },
    } as const
    const dependencies = Layer.merge(
      Layer.succeed(EventLog, eventLog),
      Layer.succeed(ValuesStore, store),
    )

    const first = await createSpecterApp(config, dependencies)
    const firstExecution = await first.command({
      type: 'recordValue',
      payload: 1,
    })
    await expect(firstExecution.reactions).rejects.toThrow(
      'Reaction run failed for: publishValue',
    )
    await expect(
      Effect.runPromise(
        store.read('publishValue', (state, cursor) =>
          Effect.succeed({ state, cursor }),
        ),
      ),
    ).resolves.toEqual({ state: { values: [] }, cursor: 0 })
    await first.close()

    fail = false
    const second = await createSpecterApp(config, dependencies)
    const secondExecution = await second.command({
      type: 'recordValue',
      payload: 2,
    })
    await secondExecution.reactions
    await expect(
      Effect.runPromise(
        store.read('publishValue', (state, cursor) =>
          Effect.succeed({ state, cursor }),
        ),
      ),
    ).resolves.toEqual({ state: { values: [1, 2] }, cursor: 2 })
    expect(deliveries).toEqual([
      'publishValue:1',
      'publishValue:1',
      'publishValue:2',
    ])
    await second.close()
  })

  it('runs a Reaction once per commit, not once per Event', async () => {
    const valueRecorded = createEventDefinition('value-recorded', numberSchema)
    const deliveries: Array<{ id: string; values: readonly number[] }> = []
    const recordValues = createCommandSlice('recordValues')
      .description('Records values in one commit.')
      .scenarios({
        description: 'Records two values.',
        given: [],
        when: [1, 2],
        expect: [event('value-recorded', 1), event('value-recorded', 2)],
      })
      .inputSchema<readonly number[]>()
      .store(ValuesStore)
      .handle(async (values) =>
        values.map((value) => valueRecorded.create(value)),
      )
    const reaction = createReactionSlice('publishValues')
      .description('Publishes once after each commit.')
      .scenarios({
        description: 'Publishes two values together.',
        given: [event('value-recorded', 1), event('value-recorded', 2)],
        expect: [1, 2],
      })
      .outputSchema<readonly number[]>()
      .plugin(() =>
        Effect.succeed((values, context) =>
          Effect.sync(() => {
            deliveries.push({ id: context.deliveryId, values: [...values] })
          }),
        ),
      )
      .store(ValuesStore)
      .apply(valueRecorded, async (applied, state) => {
        state.values.push(applied.payload)
      })
      .handle(async (state) => [...state.values])
    const app = await createSpecterApp(
      {
        events: [valueRecorded],
        slices: { recordValues, publishValues: reaction },
      } as const,
      Layer.mergeAll(
        Layer.succeed(EventLog, makeEventLogService()),
        Layer.succeed(ValuesStore, makeStoreService()),
      ),
    )

    const first = await app.command({
      type: 'recordValues',
      payload: [1, 2],
    })
    await first.reactions
    const second = await app.command({ type: 'recordValues', payload: [3] })
    await second.reactions

    expect(deliveries).toEqual([
      { id: 'publishValues:2', values: [1, 2] },
      { id: 'publishValues:3', values: [1, 2, 3] },
    ])
    await app.close()
  })

  it('advances past irrelevant commits without invoking the handler', async () => {
    const valueRecorded = createEventDefinition('value-recorded', numberSchema)
    const otherRecorded = createEventDefinition('other-recorded', numberSchema)
    const store = makeStoreService()
    let handles = 0
    const recordOther = createCommandSlice('recordOther')
      .description('Records an unrelated value.')
      .scenarios({
        description: 'Records an unrelated value.',
        given: [],
        when: 9,
        expect: [event('other-recorded', 9)],
      })
      .inputSchema<number>()
      .store(ValuesStore)
      .handle(async (value) => [otherRecorded.create(value)])
    const recordValue = createCommandSlice('recordValue')
      .description('Records a relevant value.')
      .scenarios({
        description: 'Records a relevant value.',
        given: [],
        when: 7,
        expect: [event('value-recorded', 7)],
      })
      .inputSchema<number>()
      .store(ValuesStore)
      .handle(async (value) => [valueRecorded.create(value)])
    const reaction = createReactionSlice('publishRelevantValue')
      .description('Publishes relevant values.')
      .scenarios({
        description: 'Publishes one relevant value.',
        given: [event('value-recorded', 7)],
        expect: 7,
      })
      .outputSchema<number>()
      .plugin(() => Effect.succeed(() => Effect.void))
      .store(ValuesStore)
      .apply(valueRecorded, async (applied, state) => {
        state.values.push(applied.payload)
      })
      .handle(async (state) => {
        handles += 1
        return state.values.at(-1)
      })
    const app = await createSpecterApp(
      {
        events: [valueRecorded, otherRecorded],
        slices: {
          recordOther,
          recordValue,
          publishRelevantValue: reaction,
        },
      } as const,
      Layer.mergeAll(
        Layer.succeed(EventLog, makeEventLogService()),
        Layer.succeed(ValuesStore, store),
      ),
    )

    const irrelevant = await app.command({ type: 'recordOther', payload: 9 })
    await irrelevant.reactions
    await expect(
      Effect.runPromise(
        store.read('publishRelevantValue', (_state, cursor) =>
          Effect.succeed(cursor),
        ),
      ),
    ).resolves.toBe(1)
    expect(handles).toBe(0)

    const relevant = await app.command({ type: 'recordValue', payload: 7 })
    await relevant.reactions
    expect(handles).toBe(1)
    await app.close()
  })

  it('serializes overlapping local Reaction runners', async () => {
    const valueRecorded = createEventDefinition('value-recorded', numberSchema)
    const deliveries: string[] = []
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
    const reaction = createReactionSlice('publishValue')
      .description('Publishes each commit once.')
      .scenarios({
        description: 'Publishes one value.',
        given: [event('value-recorded', 1)],
        expect: 1,
      })
      .outputSchema<number>()
      .plugin(() =>
        Effect.succeed((_output, context) =>
          Effect.gen(function* () {
            deliveries.push(context.deliveryId)
            yield* Effect.sleep('5 millis')
          }),
        ),
      )
      .store(ValuesStore)
      .apply(valueRecorded, async (applied, state) => {
        state.values.push(applied.payload)
      })
      .handle(async (state) => state.values.at(-1))
    const app = await createSpecterApp(
      {
        events: [valueRecorded],
        slices: { recordValue, publishValue: reaction },
      } as const,
      Layer.mergeAll(
        Layer.succeed(EventLog, makeEventLogService()),
        Layer.succeed(ValuesStore, makeStoreService()),
      ),
    )

    const first = await app.command({ type: 'recordValue', payload: 1 })
    const second = await app.command({ type: 'recordValue', payload: 2 })
    await Promise.all([first.reactions, second.reactions])

    expect(deliveries).toEqual(['publishValue:1', 'publishValue:2'])
    await app.close()
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
      slices: {
        recordValue: record,
        publishValue: publish,
        publishRecordedValue: reaction,
      },
    } as const).pipe(
      Layer.provide(
        Layer.mergeAll(
          storeLayer(),
          eventLogLayer([], () => {
            appendCount += 1
          }),
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
    const config = {
      events: [valueRecorded],
      slices: { recordValue: command },
    } as const
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
                Layer.mergeAll(storeLayer(), Layer.succeed(EventLog, eventLog)),
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
      slices: { recordFirst: command, values: query },
    } as const).pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(ValuesStore, store),
          eventLogLayer([
            { type: 'first-recorded', payload: 1 },
            { type: 'second-recorded', payload: 2 },
          ]),
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
      slices: { recordValue: command, values: query },
    } as const).pipe(
      Layer.provide(Layer.mergeAll(storeLayer(), eventLogLayer())),
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
      slices: { recordValue: command, missingValue: query },
    } as const).pipe(
      Layer.provide(Layer.mergeAll(storeLayer(), eventLogLayer())),
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
        slices: { recordValue, recordOther, values },
      } as const,
      Layer.mergeAll(
        Layer.succeed(EventLog, makeEventLogService()),
        Layer.succeed(ValuesStore, makeStoreService()),
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
      slices: { recordValue: command, values: query },
    } as const
    const dependencies = () =>
      Layer.mergeAll(
        Layer.succeed(EventLog, makeEventLogService()),
        Layer.succeed(ValuesStore, makeStoreService()),
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
      slices: { recordValue: command },
    } as const).pipe(
      Layer.provide(Layer.mergeAll(storeLayer(), eventLogLayer())),
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
  const commitList: EventLogCommit[] =
    events.length > 0
      ? [
          {
            events: [...events],
            version: events.length,
            committedAt: new Date(0).toISOString(),
          },
        ]
      : []
  const commits = new Map<string, EventLogCommit>()
  const service: EventLogService = {
    query: (after, types) =>
      Effect.succeed(
        events.filter(
          (item) => item.order > after && types.includes(item.type),
        ),
      ),
    currentVersion: Effect.sync(() => events.length),
    commitsAfter: (afterVersion) =>
      Effect.sync(() =>
        commitList.filter((commit) => commit.version > afterVersion),
      ),
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
            committedAt: new Date(0).toISOString(),
            idempotencyKey: options.idempotencyKey,
            fingerprint: options.fingerprint,
          } satisfies EventLogCommit
          commitList.push(commit)
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

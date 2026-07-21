import type { StandardSchemaV1 } from '@standard-schema/spec'
import { Context, Effect, Fiber, Layer, Stream } from 'effect'
import { describe, expect, it } from 'vitest'

import type {
  EventLogAdapter,
  ReactionScheduler,
  SliceStoreService,
} from '..'
import { createEventDefinition, SpecterStoreConfigurationError } from '..'
import {
  createCommandSlice,
  createQuerySlice,
  event,
} from '../spec-entry'
import { createSpecterAppLayer, SpecterRuntime } from './runtime'

type State = { values: number[] }
class ValuesStore extends Context.Service<
  ValuesStore,
  SliceStoreService<Readonly<State>, State>
>()('specter-test/ValuesStore') {}

const numberSchema: StandardSchemaV1<number> = {
  '~standard': {
    version: 1,
    vendor: 'specter-effect-test',
    validate: (value) => ({ value: value as number }),
  },
}

describe('Effect-native runtime', () => {
  it('fails startup when a dynamic Layer provides malformed Store service', async () => {
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
    const query = createQuerySlice('health')
      .description('Reads health.')
      .scenarios({
        description: 'Reports healthy.',
        given: [],
        when: {},
        expect: 'ok',
      })
      .inputSchema<Record<string, never>>()
      .outputSchema<string>()
      .store(ValuesStore)
      .handle(async () => 'ok')
    const layer = createSpecterAppLayer({
      events: [valueRecorded],
      eventLog: memoryEventLog(),
      schedule: immediateScheduler,
      slices: [command, query],
    } as const).pipe(
      Layer.provide(Layer.succeed(ValuesStore, {} as never)),
    )

    const result = await Effect.runPromise(
      Effect.result(
        Effect.scoped(
          Effect.provide(Effect.service(SpecterRuntime), layer),
        ),
      ),
    )
    expect(result._tag).toBe('Failure')
    if (result._tag === 'Success') throw new Error('startup unexpectedly passed')
    const failure: SpecterStoreConfigurationError = result.failure
    expect(failure).toMatchObject({
      _tag: 'SpecterStoreConfigurationError',
      code: 'SPECTER_STORE_CONFIGURATION',
      sliceName: 'recordValue',
      storeKey: ValuesStore.key,
    })
  })

  it('resolves Store Tags and runs command/query through one Layer graph', async () => {
    const valueRecorded = createEventDefinition('value-recorded', numberSchema)
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
      .description('Reads recorded values.')
      .scenarios({
        description: 'Reads one value.',
        given: [event('value-recorded', 3)],
        when: {},
        expect: [3],
      })
      .inputSchema<Record<string, never>>()
      .outputSchema<readonly number[]>()
      .store(ValuesStore)
      .apply(valueRecorded, async (event, state) => {
        state.values.push(event.payload)
      })
      .handle(async (_query, state) => state.values)
    const config = {
      events: [valueRecorded],
      eventLog: memoryEventLog(),
      schedule: immediateScheduler,
      slices: [recordValue, values],
    } as const
    const layer = createSpecterAppLayer(config).pipe(
      Layer.provide(memoryStoreLayer()),
    )
    const program = Effect.gen(function* () {
      const app = yield* SpecterRuntime
      const execution = yield* app.command({ type: 'recordValue', payload: 3 })
      yield* execution.reactions
      return yield* app.query({ type: 'values', payload: {} })
    })

    await expect(
      Effect.runPromise(Effect.scoped(Effect.provide(program, layer))),
    ).resolves.toEqual([3])
  })

  it('publishes query invalidations through native Stream', async () => {
    const valueRecorded = createEventDefinition('value-recorded', numberSchema)
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
      .apply(valueRecorded, async (event, state) => {
        state.values.push(event.payload)
      })
      .handle(async (_query, state) => state.values)
    const layer = createSpecterAppLayer({
      events: [valueRecorded],
      eventLog: memoryEventLog(),
      schedule: immediateScheduler,
      slices: [recordValue, values],
    } as const).pipe(Layer.provide(memoryStoreLayer()))
    const program = Effect.gen(function* () {
      const app = yield* SpecterRuntime
      const fiber = yield* app.subscribe({ type: 'values', payload: {} }).pipe(
        Stream.take(2),
        Stream.runCollect,
        Effect.forkChild,
      )
      yield* Effect.sleep('10 millis')
      const execution = yield* app.command({ type: 'recordValue', payload: 1 })
      yield* execution.reactions
      return yield* Fiber.join(fiber)
    })

    const valuesSeen = await Effect.runPromise(
      Effect.scoped(Effect.provide(program, layer)),
    )
    expect(Array.from(valuesSeen)).toEqual([[], [1]])
  })
})

function memoryStoreLayer() {
  return Layer.sync(ValuesStore, () => {
    const entries = new Map<string, { state: State; cursor: number }>()
    const entry = (sliceName: string) => {
      const found = entries.get(sliceName)
      if (found) return found
      const created = { state: { values: [] }, cursor: 0 }
      entries.set(sliceName, created)
      return created
    }
    return ValuesStore.of({
      read: (sliceName, run) =>
        Effect.tryPromise(() => {
          const current = entry(sliceName)
          return run(current.state, current.cursor)
        }),
      transaction: (sliceName, run) =>
        Effect.tryPromise(async () => {
          const current = entry(sliceName)
          const working = structuredClone(current)
          const result = await run(
            working.state,
            () => working.state,
            working.cursor,
            async (order) => {
              if (order < working.cursor) return
              working.cursor = order
            },
          )
          if (working.cursor >= current.cursor) entries.set(sliceName, working)
          return result
        }),
    })
  })
}

const immediateScheduler: ReactionScheduler = (run) => () => {
  const completion = run({
    deliveryId: 'effect-test-pass',
    scheduledAt: new Date(0).toISOString(),
    attemptId: 'effect-test-pass:attempt:1',
    attemptNumber: 1,
  })
  return () => completion
}

function memoryEventLog(): EventLogAdapter {
  const events: Array<{
    id: string
    order: number
    type: string
    payload: unknown
    recordedAt: string
  }> = []
  const adapter: EventLogAdapter = {
    query: async (after, types) =>
      events.filter((item) => item.order > after && types.includes(item.type)),
    currentVersion: async () => events.length,
    findCommit: async () => undefined,
    append: async (drafts, options = {}) => {
      if (
        options.expectedVersion !== undefined &&
        options.expectedVersion !== events.length
      ) {
        throw new Error('version conflict')
      }
      const persisted = drafts.map((draft) => ({
        ...draft,
        id: `event-${events.length + 1}`,
        order: events.length + 1,
        recordedAt: new Date(0).toISOString(),
      }))
      events.push(...persisted)
      return {
        events: persisted,
        version: events.length,
        duplicate: false,
        idempotencyKey: options.idempotencyKey,
        fingerprint: options.fingerprint,
      }
    },
    transaction: (run) => run(adapter),
  }
  return adapter
}

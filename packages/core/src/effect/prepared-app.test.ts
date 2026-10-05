import type { StandardSchemaV1 } from '@standard-schema/spec'
import { Context, Effect, Layer } from 'effect'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createEventDefinition,
  createSpecterApp,
  EventLog,
  type EventLogCommit,
  type EventLogService,
  type PreparedSpecterApp,
  prepareSpecterApp,
  ReactionRunFailure,
  type SliceStoreService,
  SpecterConformanceError,
  SpecterProjectionFailedError,
  SpecterStoreConfigurationError,
} from '..'
import {
  assertConforms,
  createCommandSlice,
  createQuerySlice,
  createReactionSlice,
  event,
} from '../definition'
import {
  createSpecterAppLayer,
  createSpecterPromiseApp,
  makeSpecterRuntime,
  prepareSpecterRuntime,
  SpecterRuntime,
} from './runtime'

vi.mock('../definition/conformance', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../definition/conformance')>()
  return { ...original, assertConforms: vi.fn(original.assertConforms) }
})

const conformance = vi.mocked(assertConforms)

type State = { values: number[] }
class PreparedStore extends Context.Service<
  PreparedStore,
  SliceStoreService<Readonly<State>, State>
>()('specter-test/PreparedStore') {}

afterEach(() => {
  conformance.mockClear()
})

describe('prepared Specter apps', () => {
  it('validates a config once and reuses it for every app', async () => {
    const config = makeConfig()
    const first = await createSpecterApp(config, dependencies())
    const second = await createSpecterApp(config, dependencies())
    // Rebuilding the outer object keeps the same events and slices objects.
    const third = await createSpecterApp({ ...config }, dependencies())
    expect(validationsOf(config)).toBe(1)

    await first.command({ type: 'recordValue', payload: 1 })
    await expect(first.query({ type: 'values', payload: {} })).resolves.toEqual(
      [1],
    )
    await expect(
      second.query({ type: 'values', payload: {} }),
    ).resolves.toEqual([])
    await expect(third.query({ type: 'values', payload: {} })).resolves.toEqual(
      [],
    )
    await Promise.all([first.close(), second.close(), third.close()])
    expect(validationsOf(config)).toBe(1)
  })

  it('shares one in-flight validation across concurrent first use', async () => {
    let release = () => {}
    const config = makeConfig(
      new Promise<void>((resolve) => {
        release = resolve
      }),
    )
    const promiseApps = Promise.all(
      Array.from({ length: 20 }, () =>
        createSpecterApp(config, dependencies()),
      ),
    )
    const effectApps = Promise.all(
      Array.from({ length: 5 }, () =>
        Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const app = yield* SpecterRuntime
              return yield* app.query({ type: 'values', payload: {} })
            }).pipe(
              Effect.provide(
                createSpecterAppLayer(config).pipe(
                  Layer.provide(dependencies()),
                ),
              ),
            ),
          ),
        ),
      ),
    )
    // Every caller is now waiting on the one validation held open by the gate.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(validationsOf(config)).toBe(1)
    release()

    const apps = await promiseApps
    await expect(effectApps).resolves.toEqual(Array(5).fill([]))
    expect(validationsOf(config)).toBe(1)
    await Promise.all(apps.map((app) => app.close()))
  })

  it('rejects createSpecterApp for an invalid config on every call', async () => {
    const config = makeConfig()
    const invalid = { events: [], slices: config.slices }

    const results = await Promise.allSettled(
      Array.from({ length: 3 }, () =>
        createSpecterApp(invalid, dependencies()),
      ),
    )
    for (const result of results) {
      expect(result.status).toBe('rejected')
      expect(result.status === 'rejected' && result.reason).toBeInstanceOf(
        SpecterConformanceError,
      )
    }
    expect(validationsOf(invalid)).toBe(1)

    // Failures are not cached: a later caller validates again.
    await expect(
      createSpecterApp(invalid, dependencies()),
    ).rejects.toBeInstanceOf(SpecterConformanceError)
    await expect(prepareSpecterApp(invalid)).rejects.toMatchObject({
      code: 'SPECTER_CONFORMANCE_FAILED',
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'unknown-scenario-event' }),
      ]),
    })
    expect(validationsOf(invalid)).toBe(3)
  })

  it('rejects createSpecterApp for per-log startup failures', async () => {
    const config = makeConfig()
    // No Store Layer: conformance passes, Store resolution cannot.
    const withoutStore = Layer.succeed(EventLog, makeEventLogService())
    await expect(
      createSpecterApp(config, withoutStore as never),
    ).rejects.toBeInstanceOf(SpecterStoreConfigurationError)

    // A log failure does not evict the validated config.
    const app = await createSpecterApp(config, dependencies())
    await expect(app.query({ type: 'values', payload: {} })).resolves.toEqual(
      [],
    )
    await app.close()
    expect(validationsOf(config)).toBe(1)
  })

  it('reports createSpecterPromiseApp startup failures from operations', async () => {
    const config = makeConfig()
    const withoutStore = Layer.succeed(EventLog, makeEventLogService())
    const app = createSpecterPromiseApp(config, withoutStore as never)
    await expect(
      app.query({ type: 'values', payload: {} }),
    ).rejects.toBeInstanceOf(SpecterStoreConfigurationError)
    await expect(
      app.command({ type: 'recordValue', payload: 1 }),
    ).rejects.toBeInstanceOf(SpecterStoreConfigurationError)
    await app.close()

    // An app that is never called must not leak an unhandled rejection.
    const idle = createSpecterPromiseApp(config, withoutStore as never)
    await new Promise((resolve) => setTimeout(resolve, 20))
    await idle.close()
  })

  it('binds a Promise-prepared app to many Event Logs', async () => {
    const config = makeConfig()
    const prepared = await prepareSpecterApp(config)
    expect(prepared).toMatchObject({ _tag: 'PreparedSpecterApp', config })
    await expect(prepareSpecterApp(prepared)).resolves.toBe(prepared)

    const apps = await Promise.all(
      Array.from({ length: 3 }, () =>
        createSpecterApp(prepared, dependencies()),
      ),
    )
    await apps[0].command({ type: 'recordValue', payload: 7 })
    await expect(
      apps[0].query({ type: 'values', payload: {} }),
    ).resolves.toEqual([7])
    await expect(
      apps[1].query({ type: 'values', payload: {} }),
    ).resolves.toEqual([])
    await Promise.all(apps.map((app) => app.close()))
    expect(validationsOf(config)).toBe(1)
  })

  it('binds an Effect-prepared app through the Layer and interpreter', async () => {
    const config = makeConfig()
    const program = Effect.gen(function* () {
      const prepared = yield* prepareSpecterRuntime(config)
      const viaLayer = yield* Effect.scoped(
        Effect.gen(function* () {
          const app = yield* SpecterRuntime
          yield* app.command({ type: 'recordValue', payload: 2 })
          return yield* app.query({ type: 'values', payload: {} })
        }).pipe(
          Effect.provide(
            createSpecterAppLayer(prepared).pipe(Layer.provide(dependencies())),
          ),
        ),
      )
      const viaInterpreter = yield* Effect.scoped(
        Effect.gen(function* () {
          const app = yield* makeSpecterRuntime(prepared)
          return yield* app.query({ type: 'values', payload: {} })
        }).pipe(Effect.provide(dependencies())),
      )
      return { viaLayer, viaInterpreter }
    })

    await expect(Effect.runPromise(program)).resolves.toEqual({
      viaLayer: [2],
      viaInterpreter: [],
    })
    expect(validationsOf(config)).toBe(1)
  })

  it('fails prepareSpecterRuntime with the conformance error', async () => {
    const config = makeConfig()
    const failure = await Effect.runPromise(
      prepareSpecterRuntime({ events: [], slices: config.slices }).pipe(
        Effect.flip,
      ),
    )
    expect(failure).toBeInstanceOf(SpecterConformanceError)
  })

  it('revalidates a forged prepared wrapper instead of crashing', async () => {
    const config = makeConfig()
    // Hand-built (or from another copy of core): not registered, not branded.
    const forged = {
      _tag: 'PreparedSpecterApp',
      config,
    } as unknown as PreparedSpecterApp<typeof config>

    const app = await createSpecterApp(forged, dependencies())
    await expect(app.query({ type: 'values', payload: {} })).resolves.toEqual(
      [],
    )
    await app.close()
    const prepared = await prepareSpecterApp(forged)
    expect(prepared).not.toBe(forged)
    expect(prepared.config).toBe(config)
    expect(validationsOf(config)).toBe(1)

    const invalid = {
      _tag: 'PreparedSpecterApp',
      config: { events: [], slices: config.slices },
    } as unknown as PreparedSpecterApp<typeof config>
    await expect(
      createSpecterApp(invalid, dependencies()),
    ).rejects.toBeInstanceOf(SpecterConformanceError)
  })

  it('freezes a cached config so later mutation throws', async () => {
    const config = makeConfig()
    await prepareSpecterApp(config)
    expect(Object.isFrozen(config.events)).toBe(true)
    expect(Object.isFrozen(config.slices)).toBe(true)
    expect(() => {
      ;(config.events as unknown as unknown[]).push(config.events[0])
    }).toThrow(TypeError)
  })

  it.each([
    'reaction',
    'eager',
  ] as const)('disposes dependencies after a startup %s failure', async (kind) => {
    const config = makeStartupFailureConfig(kind)
    let released = 0
    await expect(
      createSpecterApp(
        config,
        trackedDependencies([1], () => {
          released += 1
        }) as never,
      ),
    ).rejects.toBeInstanceOf(
      kind === 'reaction' ? ReactionRunFailure : SpecterProjectionFailedError,
    )
    expect(released).toBe(1)
  })
})

function validationsOf(config: { readonly slices: object }) {
  return conformance.mock.calls.filter(
    ([input]) => input.slices === config.slices,
  ).length
}

/** Fresh Event and Slice objects, so module-level caching never leaks. */
function makeConfig(validationGate?: Promise<void>) {
  const numberSchema: StandardSchemaV1<number> = {
    '~standard': {
      version: 1,
      vendor: 'specter-test',
      validate: async (value) => {
        await validationGate
        return typeof value === 'number'
          ? { value }
          : { issues: [{ message: 'Expected number' }] }
      },
    },
  }
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
    .store(PreparedStore)
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
    .store(PreparedStore)
    .apply(valueRecorded, async (applied, state) => {
      state.values.push(applied.payload)
    })
    .handle(async (_input, state) => [...state.values])
  return {
    events: [valueRecorded],
    slices: { recordValue, values },
  } as const
}

function dependencies() {
  return Layer.mergeAll(
    Layer.succeed(EventLog, makeEventLogService()),
    Layer.succeed(PreparedStore, makeStoreService()),
  )
}

function makeStoreService(): SliceStoreService<Readonly<State>, State> {
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
        const working = structuredClone(entry(name))
        let publish = false
        const result = yield* run(
          working.state,
          () => working.state,
          working.cursor,
          (order) =>
            Effect.sync(() => {
              working.cursor = order
              publish = true
            }),
        )
        if (publish) entries.set(name, working)
        return result
      }),
  }
}

function makeEventLogService(): EventLogService {
  const events: Array<{
    id: string
    order: number
    type: string
    payload: unknown
    recordedAt: string
  }> = []
  const commits: EventLogCommit[] = []
  return {
    query: (after, types) =>
      Effect.sync(() =>
        events.filter(
          (item) => item.order > after && types.includes(item.type),
        ),
      ),
    currentVersion: Effect.sync(() => events.length),
    commitsAfter: (afterVersion) =>
      Effect.sync(() =>
        commits.filter((commit) => commit.version > afterVersion),
      ),
    findCommit: () => Effect.succeed(undefined),
    append: (drafts, options = {}) =>
      Effect.sync(() => {
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
          idempotencyKey: options.idempotencyKey,
          fingerprint: options.fingerprint,
        } satisfies EventLogCommit
        commits.push(commit)
        return { ...commit, duplicate: false }
      }),
  }
}

function seededEventLogService(...payloads: number[]) {
  const service = makeEventLogService()
  Effect.runSync(
    service.append(
      payloads.map((payload) => ({ type: 'value-recorded', payload })),
    ),
  )
  return service
}

/** Dependencies whose Event Log Layer records when its scope is released. */
function trackedDependencies(seed: readonly number[], onRelease: () => void) {
  return Layer.mergeAll(
    Layer.effect(
      EventLog,
      Effect.acquireRelease(
        Effect.sync(() => seededEventLogService(...seed)),
        () => Effect.sync(onRelease),
      ),
    ),
    Layer.succeed(PreparedStore, makeStoreService()),
  )
}

/** makeConfig plus one Slice that fails during startup catch-up. */
function makeStartupFailureConfig(kind: 'reaction' | 'eager') {
  const { events, slices } = makeConfig()
  const [valueRecorded] = events
  const failing =
    kind === 'reaction'
      ? createReactionSlice('publishValue')
          .description('Publishes the latest value.')
          .scenarios({
            description: 'Publishes one value.',
            given: [event('value-recorded', 1)],
            expect: 1,
          })
          .outputSchema<number>()
          .plugin(() => Effect.succeed(() => Effect.void))
          .store(PreparedStore)
          .apply(valueRecorded, async (applied, state) => {
            state.values.push(applied.payload)
          })
          .handle(async () => {
            throw new Error('Reaction failed at startup')
          })
      : createQuerySlice('eagerValues')
          .description('Warms values during startup.')
          .scenarios({
            description: 'Reads one value.',
            given: [event('value-recorded', 1)],
            when: {},
            expect: [1],
          })
          .inputSchema<Record<string, never>>()
          .outputSchema<readonly number[]>()
          .store(PreparedStore, { eager: true })
          .apply(valueRecorded, async () => {
            throw new Error('Projection failed at startup')
          })
          .handle(async (_input, state) => [...state.values])
  return {
    events,
    slices: { ...slices, [failing.name]: failing },
  }
}

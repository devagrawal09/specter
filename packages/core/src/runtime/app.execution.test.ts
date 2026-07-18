import type { StandardSchemaV1 } from '@standard-schema/spec'
import { describe, expect, test, vi } from 'vitest'

import type {
  EventLogAdapter,
  EventLogAppendOptions,
  EventLogCommit,
  PersistedEvent,
  ReactionScheduler,
  SliceStoreAdapter,
  SpecterObservation,
} from '..'
import {
  createEventDefinition,
  type ReactionRunFailure,
  SpecterEventLogOrderError,
  SpecterIdempotencyConflictError,
  SpecterUnknownCommandError,
  SpecterUnknownQueryError,
  SpecterVersionConflictError,
} from '..'
import {
  createCommandSlice,
  createQuerySlice,
  createReactionSlice,
  event,
} from '../spec-entry'
import { createSpecterApp } from './app'

function schema<TInput, TOutput>(
  decode: (input: TInput) => TOutput | Promise<TOutput>,
): StandardSchemaV1<TInput, TOutput> {
  return {
    '~standard': {
      version: 1,
      vendor: 'specter-core-test',
      validate: async (value) => ({ value: await decode(value as TInput) }),
    },
  }
}

function memoryStore<TState extends object>(
  state: TState,
  hooks?: {
    readonly onGet?: () => void
    readonly onTransaction?: () => void
  },
): SliceStoreAdapter<TState> {
  let lastAppliedOrder = 0
  const adapter: SliceStoreAdapter<TState> = {
    async get() {
      hooks?.onGet?.()
      return {
        write: state,
        read: state,
        lastAppliedOrder: async () => lastAppliedOrder,
        setLastAppliedOrder: async (order) => {
          lastAppliedOrder = order
        },
      }
    },
    async transaction(sliceName, run) {
      hooks?.onTransaction?.()
      return run(await adapter.get(sliceName))
    },
  }
  return adapter
}

function stagedMemoryStore<TState extends object>(
  state: TState,
): SliceStoreAdapter<TState> {
  let lastAppliedOrder = 0
  const adapter: SliceStoreAdapter<TState> = {
    async get() {
      const staged = structuredClone(state)
      return {
        write: staged,
        read: staged,
        lastAppliedOrder: async () => lastAppliedOrder,
        setLastAppliedOrder: async (order) => {
          for (const key of Reflect.ownKeys(state)) {
            Reflect.deleteProperty(state, key)
          }
          Object.assign(state, staged)
          lastAppliedOrder = order
        },
      }
    },
    async transaction(sliceName, run) {
      return run(await adapter.get(sliceName))
    },
  }
  return adapter
}

function memoryEventLog(initialEvents: readonly PersistedEvent[] = []) {
  let nextOrder = Math.max(0, ...initialEvents.map(({ order }) => order)) + 1
  const events: PersistedEvent[] = [...initialEvents]
  const commits = new Map<string, EventLogCommit>()
  let insideTransaction = false
  const adapter: EventLogAdapter = {
    async query(order, eventTypes) {
      return events.filter(
        (candidate) =>
          candidate.order > order && eventTypes.includes(candidate.type),
      )
    },
    async currentVersion() {
      return nextOrder - 1
    },
    async findCommit(idempotencyKey) {
      return commits.get(idempotencyKey)
    },
    async append(drafts, options: EventLogAppendOptions = {}) {
      const existing = options.idempotencyKey
        ? commits.get(options.idempotencyKey)
        : undefined
      if (existing) {
        if (existing.fingerprint !== options.fingerprint) {
          throw new SpecterIdempotencyConflictError(
            options.idempotencyKey ?? '',
          )
        }
        return { ...existing, duplicate: true }
      }
      const version = nextOrder - 1
      if (
        options.expectedVersion !== undefined &&
        options.expectedVersion !== version
      ) {
        throw new SpecterVersionConflictError(options.expectedVersion, version)
      }
      const appended = drafts.map((draft) => ({
        ...draft,
        id: `event-${nextOrder}`,
        order: nextOrder++,
        recordedAt: '1970-01-01T00:00:00.000Z',
      }))
      events.push(...appended)
      const commit = {
        events: appended,
        version: nextOrder - 1,
        idempotencyKey: options.idempotencyKey,
        fingerprint: options.fingerprint,
      } satisfies EventLogCommit
      if (options.idempotencyKey) commits.set(options.idempotencyKey, commit)
      return { ...commit, duplicate: false }
    },
    async transaction(run) {
      expect(insideTransaction).toBe(false)
      insideTransaction = true
      try {
        return await run(adapter)
      } finally {
        insideTransaction = false
      }
    },
  }
  return { adapter, events, isInsideTransaction: () => insideTransaction }
}

const immediateScheduler: ReactionScheduler = (run) => {
  let requested = false
  let active: Promise<void> | undefined
  let nextDelivery = 1
  let waiters: { resolve: () => void; reject: (cause: unknown) => void }[] = []

  async function drain(delivery: number) {
    try {
      do {
        requested = false
        await run({
          deliveryId: `delivery-${delivery}`,
          scheduledAt: '2026-07-16T00:00:00.000Z',
          attemptId: `delivery-${delivery}-attempt-1`,
          attemptNumber: 1,
        })
      } while (requested)
      const settled = waiters
      waiters = []
      for (const waiter of settled) waiter.resolve()
    } catch (cause) {
      requested = false
      const settled = waiters
      waiters = []
      for (const waiter of settled) waiter.reject(cause)
    } finally {
      active = undefined
    }
  }

  return () => {
    requested = true
    if (!active) active = drain(nextDelivery++)

    return () => {
      if (!active && !requested) return Promise.resolve()
      return new Promise<void>((resolve, reject) => {
        waiters.push({ resolve, reject })
      })
    }
  }
}

const idleScheduler: ReactionScheduler = () => () => () => Promise.resolve()

describe('createSpecterApp execution contracts', () => {
  test('emits deterministic causal Command and Query observations without payloads', async () => {
    const valueRecorded = createEventDefinition(
      'value-recorded',
      schema<number, number>((value) => value),
    )
    const command = createCommandSlice('recordValue')
      .description('Records a value.')
      .scenarios({
        description: 'Records one value.',
        given: [],
        when: 7,
        expect: [event('value-recorded', 7)],
      })
      .inputSchema<number>()
      .store(memoryStore({}))
      .handle(async (value) => [valueRecorded.create(value)])
    const query = createQuerySlice('currentValue')
      .description('Reads the current value.')
      .scenarios({
        description: 'Reads one value.',
        given: [event('value-recorded', 7)],
        when: {},
        expect: 7,
      })
      .inputSchema<Record<string, never>>()
      .outputSchema<number>()
      .store(memoryStore({ value: 0 }))
      .apply(valueRecorded, async (applied, state) => {
        state.value = applied.payload
      })
      .handle(async (_input, state) => state.value)
    const observations: SpecterObservation[] = []
    let nextId = 1
    const app = await createSpecterApp({
      events: [valueRecorded],
      eventLog: memoryEventLog().adapter,
      schedule: idleScheduler,
      slices: [command, query],
      observe: (observation) => observations.push(observation),
      runtime: {
        generateId: () => `runtime-id-${nextId++}`,
        now: () => 0,
      },
    })

    const execution = await app.command(
      { type: 'recordValue', payload: 7 },
      {
        correlationId: 'request-1',
        parentOperationIds: ['http-request-1'],
      },
    )
    await expect(
      app.query(
        { type: 'currentValue', payload: {} },
        { operationId: 'protocol-query-1', correlationId: 'request-1' },
      ),
    ).resolves.toBe(7)
    await expect(
      app.command({ type: 'missing', payload: null } as never),
    ).rejects.toBeInstanceOf(SpecterUnknownCommandError)

    expect(execution.operationId).toBe('runtime-id-1')
    expect(observations[0]).toEqual({
      observationId: 'runtime-id-2',
      observedAt: '1970-01-01T00:00:00.000Z',
      operationId: execution.operationId,
      correlationId: 'request-1',
      parentOperationIds: ['http-request-1'],
      causedByEvents: [],
      type: 'command-started',
      commandType: 'recordValue',
    })
    const persistedObservation = observations.find(
      (observation) => observation.type === 'event-persisted',
    )
    expect(persistedObservation).toMatchObject({
      operationId: execution.operationId,
      type: 'event-persisted',
      event: {
        id: 'event-1',
        type: 'value-recorded',
        order: 1,
        recordedAt: '1970-01-01T00:00:00.000Z',
        commitVersion: 1,
      },
    })
    const completedObservation = observations.find(
      (observation) => observation.type === 'command-completed',
    )
    expect(completedObservation).toMatchObject({
      operationId: execution.operationId,
      correlationId: 'request-1',
      type: 'command-completed',
      commandType: 'recordValue',
      events: [
        {
          id: 'event-1',
          type: 'value-recorded',
          order: 1,
          recordedAt: '1970-01-01T00:00:00.000Z',
          commitVersion: 1,
        },
      ],
    })
    expect(persistedObservation).not.toHaveProperty('payload')
    expect(persistedObservation).not.toHaveProperty('event.payload')
    expect(observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'slice-caught-up',
          sliceName: 'currentValue',
          sliceKind: 'query',
          events: [
            expect.objectContaining({ id: 'event-1', type: 'value-recorded' }),
          ],
        }),
        expect.objectContaining({
          type: 'query-completed',
          operationId: 'protocol-query-1',
          queryName: 'currentValue',
          correlationId: 'request-1',
          parentOperationIds: [execution.operationId],
          causedByEvents: [
            expect.objectContaining({ id: 'event-1', type: 'value-recorded' }),
          ],
        }),
        expect.objectContaining({
          type: 'command-rejected',
          commandType: 'missing',
          cause: expect.any(SpecterUnknownCommandError),
        }),
      ]),
    )
  })

  test('isolates every observer failure from Command and Query semantics', async () => {
    const valueRecorded = createEventDefinition(
      'value-recorded',
      schema<number, number>((value) => value),
    )
    const command = createCommandSlice('recordValue')
      .description('Records a value.')
      .scenarios({
        description: 'Records one value.',
        given: [],
        when: 1,
        expect: [event('value-recorded', 1)],
      })
      .inputSchema<number>()
      .store(memoryStore({}))
      .handle(async (value) => [valueRecorded.create(value)])
    const app = await createSpecterApp({
      events: [valueRecorded],
      eventLog: memoryEventLog().adapter,
      schedule: idleScheduler,
      slices: [command],
      observe: () => {
        throw new Error('telemetry is unavailable')
      },
    })

    await expect(
      app.command({ type: 'recordValue', payload: 1 }),
    ).resolves.toMatchObject({ duplicate: false, version: 1 })
  })

  test('exposes collision-safe command/query envelopes and rejects unknown types', async () => {
    const recorded = createEventDefinition(
      'value-recorded',
      schema<number, number>((value) => value),
    )
    const thenCommand = createCommandSlice('then')
      .description('Proves the app is not thenable.')
      .scenarios({
        description: 'Records a value.',
        given: [],
        when: 1,
        expect: [event('value-recorded', 1)],
      })
      .inputSchema<number>()
      .store(memoryStore({}))
      .handle(async (value) => [recorded.create(value)])
    const constructorQuery = createQuerySlice('constructor')
      .description('Proves inherited names are safe.')
      .scenarios({
        description: 'Reads a value.',
        given: [event('value-recorded', 1)],
        when: {},
        expect: 1,
      })
      .inputSchema<Record<string, never>>()
      .outputSchema<number>()
      .store(memoryStore({ value: 0 }))
      .apply(recorded, async (applied, state) => {
        state.value = applied.payload
      })
      .handle(async (_query, state) => state.value)
    const eventLog = memoryEventLog()

    const app = await createSpecterApp({
      events: [recorded],
      eventLog: eventLog.adapter,
      schedule: immediateScheduler,
      slices: [thenCommand, constructorQuery],
    })

    const execution = await app.command({ type: 'then', payload: 1 })
    await execution.reactions
    await expect(app.query({ type: 'constructor', payload: {} })).resolves.toBe(
      1,
    )
    await expect(
      app.command({ type: 'missing', payload: null } as never),
    ).rejects.toBeInstanceOf(SpecterUnknownCommandError)
    await expect(
      app.query({ type: 'missing', payload: null } as never),
    ).rejects.toBeInstanceOf(SpecterUnknownQueryError)
    expect(Object.keys(app)).toEqual(['command', 'query', 'subscribe'])
  })

  test('awaits async conformance and rejects unauthorized command Events', async () => {
    let releaseValidation: (() => void) | undefined
    const validationGate = new Promise<void>((resolve) => {
      releaseValidation = resolve
    })
    let validationStarted = false
    const allowed = createEventDefinition(
      'allowed-event',
      schema<{ value: number }, { value: number }>(async (payload) => {
        validationStarted = true
        await validationGate
        return payload
      }),
    )
    const unauthorized = createEventDefinition(
      'unauthorized-event',
      schema<{ value: number }, { value: number }>((payload) => payload),
    )
    const badCommand = createCommandSlice('attemptUnauthorized')
      .description('Attempts an unauthorized Event.')
      .scenarios({
        description: 'Documents only the allowed Event.',
        given: [],
        when: { value: 1 },
        expect: [event('allowed-event', { value: 1 })],
      })
      .inputSchema<{ value: number }>()
      .store(memoryStore({}))
      .handle(async (command) => [unauthorized.create(command)])
    const coveringCommand = createCommandSlice('emitUnauthorizedByContract')
      .description('Owns the otherwise unauthorized Event contract.')
      .scenarios({
        description: 'Emits the second Event.',
        given: [],
        when: { value: 2 },
        expect: [event('unauthorized-event', { value: 2 })],
      })
      .inputSchema<{ value: number }>()
      .store(memoryStore({}))
      .handle(async (command) => [unauthorized.create(command)])
    const eventLog = memoryEventLog()

    let settled = false
    const creating = createSpecterApp({
      events: [allowed, unauthorized],
      eventLog: eventLog.adapter,
      schedule: immediateScheduler,
      slices: [badCommand, coveringCommand],
    }).then((app) => {
      settled = true
      return app
    })

    await expect.poll(() => validationStarted).toBe(true)
    expect(settled).toBe(false)
    releaseValidation?.()
    const app = await creating

    await expect(
      app.command({ type: 'attemptUnauthorized', payload: { value: 1 } }),
    ).rejects.toMatchObject({
      code: 'SPECTER_INFRASTRUCTURE_FAILURE',
      message: expect.stringContaining(
        'emitted unauthorized Event "unauthorized-event" at index 0',
      ),
    })
    expect(eventLog.events).toEqual([])
  })

  test('runs command catch-up, decision, and append inside the Event Log transaction', async () => {
    const eventLog = memoryEventLog()
    const recorded = createEventDefinition(
      'value-recorded',
      schema<number, number>((value) => value),
    )
    const store = memoryStore(
      {},
      {
        onGet() {
          expect(eventLog.isInsideTransaction()).toBe(true)
        },
        onTransaction() {
          throw new Error('Command Slice State must not open a transaction')
        },
      },
    )
    const command = createCommandSlice('recordValue')
      .description('Records a value.')
      .scenarios({
        description: 'Records a value.',
        given: [],
        when: 1,
        expect: [event('value-recorded', 1)],
      })
      .inputSchema<number>()
      .store(store)
      .handle(async (value) => {
        expect(eventLog.isInsideTransaction()).toBe(true)
        return [recorded.create(value)]
      })
    const app = await createSpecterApp({
      events: [recorded],
      eventLog: eventLog.adapter,
      schedule: immediateScheduler,
      slices: [command],
    })

    const execution = await app.command({
      type: 'recordValue',
      payload: 1,
    })

    expect(execution.version).toBe(1)
    expect(eventLog.events).toHaveLength(1)
  })

  test('returns after durable commit and exposes aggregate Reaction completion', async () => {
    const sourceRecorded = createEventDefinition(
      'source-recorded',
      schema<number, number>((value) => value),
    )
    const command = createCommandSlice('recordSource')
      .description('Records a source.')
      .scenarios({
        description: 'Records a source.',
        given: [],
        when: 7,
        expect: [event('source-recorded', 7)],
      })
      .inputSchema<number>()
      .store(memoryStore({}))
      .handle(async (value) => [sourceRecorded.create(value)])
    const successfulEffect = vi.fn(async () => undefined)
    const reaction = (name: string, effect: () => Promise<void>) =>
      createReactionSlice(name)
        .description(name)
        .scenarios({
          description: `${name} reacts.`,
          given: [event('source-recorded', 7)],
          expect: [7],
        })
        .outputSchema<number>()
        .plugin(async () => effect)
        .store(memoryStore({ value: 0 }))
        .apply(sourceRecorded, async (applied, state) => {
          state.value = applied.payload
        })
        .handle(async (state) => state.value)
    const firstFailure = new Error('first failed')
    const secondFailure = new Error('second failed')
    const eventLog = memoryEventLog()
    const observe = vi.fn()
    const app = await createSpecterApp({
      events: [sourceRecorded],
      eventLog: eventLog.adapter,
      schedule: immediateScheduler,
      observe,
      slices: [
        command,
        reaction('failFirst', async () => {
          throw firstFailure
        }),
        reaction('succeed', successfulEffect),
        reaction('failSecond', async () => {
          throw secondFailure
        }),
      ],
    })

    const execution = await app.command({
      type: 'recordSource',
      payload: 7,
    })

    expect(eventLog.events).toHaveLength(1)
    expect(execution.events).toEqual(eventLog.events)
    await expect(execution.reactions).rejects.toMatchObject({
      code: 'SPECTER_REACTION_FAILURE',
      failures: [
        { sliceName: 'failFirst', cause: firstFailure },
        { sliceName: 'failSecond', cause: secondFailure },
      ],
    } satisfies Partial<ReactionRunFailure>)
    expect(successfulEffect).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        deliveryId: expect.stringContaining('succeed:1'),
        attemptNumber: 1,
      }),
    )
    expect(observe).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'reaction-run-started',
        reactionName: 'succeed',
      }),
    )
    expect(observe).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'reaction-run-completed',
        reactionName: 'succeed',
        durationMs: expect.any(Number),
      }),
    )
    expect(observe).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'reaction-run-failed',
        reactionName: 'failFirst',
        durationMs: expect.any(Number),
        cause: firstFailure,
      }),
    )
    expect(observe).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'reaction-pass-failed',
        failureCount: 2,
      }),
    )
    const committedObservation = observe.mock.calls
      .map(([observation]) => observation)
      .find((observation) => observation.type === 'command-completed')
    const successfulRun = observe.mock.calls
      .map(([observation]) => observation)
      .find(
        (observation) =>
          observation.type === 'reaction-run-started' &&
          observation.reactionName === 'succeed',
      )
    expect(successfulRun).toMatchObject({
      runId: expect.stringContaining(':succeed'),
      passId: expect.any(String),
      attemptId: expect.any(String),
      parentOperationIds: expect.arrayContaining([
        committedObservation.operationId,
      ]),
      causedByEvents: [
        expect.objectContaining({ id: 'event-1', type: 'source-recorded' }),
      ],
      eventRange: { fromOrder: 0, toOrder: 1, eventCount: 1 },
    })
  })

  test('retries failed Reaction effects with stable delivery IDs after local rollback', async () => {
    const sourceRecorded = createEventDefinition(
      'source-recorded',
      schema<number, number>((value) => value),
    )
    const command = createCommandSlice('recordSource')
      .description('Records a source.')
      .scenarios({
        description: 'Records a source.',
        given: [],
        when: 1,
        expect: [event('source-recorded', 1)],
      })
      .inputSchema<number>()
      .store(memoryStore({}))
      .handle(async (value) => [sourceRecorded.create(value)])
    const failingContexts: {
      deliveryId: string
      scheduledAt: string
      attemptId: string
      attemptNumber: number
      effect: number
    }[] = []
    const successfulEffects: number[] = []
    const retriedReaction = createReactionSlice('retryDelivery')
      .description('Retries one failed delivery.')
      .scenarios({
        description: 'Delivers the accumulated value.',
        given: [event('source-recorded', 1)],
        expect: [1],
      })
      .outputSchema<number>()
      .plugin(async () => async (effect, context) => {
        failingContexts.push({ ...context, effect })
        if (context.attemptNumber === 1) throw new Error('try again')
      })
      .store(stagedMemoryStore({ total: 0 }))
      .apply(sourceRecorded, async (applied, state) => {
        state.total += applied.payload
      })
      .handle(async (state) => state.total)
    const successfulReaction = createReactionSlice('singleDelivery')
      .description('Must not rerun after committing its cursor.')
      .scenarios({
        description: 'Delivers once.',
        given: [event('source-recorded', 1)],
        expect: [1],
      })
      .outputSchema<number>()
      .plugin(async () => async (effect) => {
        successfulEffects.push(effect)
      })
      .store(stagedMemoryStore({ total: 0 }))
      .apply(sourceRecorded, async (applied, state) => {
        state.total += applied.payload
      })
      .handle(async (state) => state.total)
    const retryScheduler: ReactionScheduler = (run) => () => {
      const active = (async () => {
        try {
          await run({
            deliveryId: 'pass-1',
            scheduledAt: '2026-07-16T01:00:00.000Z',
            attemptId: 'pass-1-attempt-1',
            attemptNumber: 1,
          })
        } catch {
          await run({
            deliveryId: 'pass-1',
            scheduledAt: '2026-07-16T01:00:00.000Z',
            attemptId: 'pass-1-attempt-2',
            attemptNumber: 2,
          })
        }
      })()
      return () => active
    }
    const app = await createSpecterApp({
      events: [sourceRecorded],
      eventLog: memoryEventLog().adapter,
      schedule: retryScheduler,
      slices: [command, retriedReaction, successfulReaction],
    })

    const execution = await app.command({
      type: 'recordSource',
      payload: 1,
    })
    await execution.reactions

    expect(failingContexts).toEqual([
      {
        deliveryId: 'pass-1:retryDelivery:1',
        scheduledAt: '2026-07-16T01:00:00.000Z',
        attemptId: 'pass-1-attempt-1:retryDelivery:1',
        attemptNumber: 1,
        effect: 1,
      },
      {
        deliveryId: 'pass-1:retryDelivery:1',
        scheduledAt: '2026-07-16T01:00:00.000Z',
        attemptId: 'pass-1-attempt-2:retryDelivery:1',
        attemptNumber: 2,
        effect: 1,
      },
    ])
    expect(successfulEffects).toEqual([1])
  })

  test('duplicate Commands drain failed Reactions again, including after restart', async () => {
    const sourceRecorded = createEventDefinition(
      'source-recorded',
      schema<number, number>((value) => value),
    )
    const commandHandle = vi.fn(async (value: number) => [
      sourceRecorded.create(value),
    ])
    const command = createCommandSlice('recordSource')
      .description('Records a source.')
      .scenarios({
        description: 'Records a source.',
        given: [],
        when: 1,
        expect: [event('source-recorded', 1)],
      })
      .inputSchema<number>()
      .store(memoryStore({}))
      .handle(commandHandle)
    const reactionStore = stagedMemoryStore({ value: 0 })
    let attempts = 0
    const reaction = createReactionSlice('retrySource')
      .description('Retries a source effect after duplicate submission.')
      .scenarios({
        description: 'Delivers the source.',
        given: [event('source-recorded', 1)],
        expect: [1],
      })
      .outputSchema<number>()
      .plugin(async () => async () => {
        attempts += 1
        if (attempts < 3) throw new Error(`failure ${attempts}`)
      })
      .store(reactionStore)
      .apply(sourceRecorded, async (applied, state) => {
        state.value = applied.payload
      })
      .handle(async (state) => state.value)
    const eventLog = memoryEventLog()
    const config = {
      events: [sourceRecorded],
      eventLog: eventLog.adapter,
      schedule: immediateScheduler,
      slices: [command, reaction],
    } as const
    const app = await createSpecterApp(config)

    const original = await app.command(
      { type: 'recordSource', payload: 1 },
      { idempotencyKey: 'source-request-1' },
    )
    await expect(original.reactions).rejects.toMatchObject({
      code: 'SPECTER_REACTION_FAILURE',
    })

    const failedRetry = await app.command(
      { type: 'recordSource', payload: 1 },
      { idempotencyKey: 'source-request-1' },
    )
    expect(failedRetry.duplicate).toBe(true)
    await expect(failedRetry.reactions).rejects.toMatchObject({
      code: 'SPECTER_REACTION_FAILURE',
    })

    const restartedApp = await createSpecterApp(config)
    const successfulRetry = await restartedApp.command(
      { type: 'recordSource', payload: 1 },
      { idempotencyKey: 'source-request-1' },
    )
    expect(successfulRetry.duplicate).toBe(true)
    await expect(successfulRetry.reactions).resolves.toBeUndefined()

    const caughtUpDuplicate = await restartedApp.command(
      { type: 'recordSource', payload: 1 },
      { idempotencyKey: 'source-request-1' },
    )
    await expect(caughtUpDuplicate.reactions).resolves.toBeUndefined()

    expect(attempts).toBe(3)
    expect(commandHandle).toHaveBeenCalledTimes(1)
    expect(eventLog.events).toHaveLength(1)
  })

  test('does not reject a committed command when Reaction scheduling fails', async () => {
    const recorded = createEventDefinition(
      'value-recorded',
      schema<number, number>((value) => value),
    )
    const command = createCommandSlice('recordValue')
      .description('Records a value.')
      .scenarios({
        description: 'Records a value.',
        given: [],
        when: 1,
        expect: [event('value-recorded', 1)],
      })
      .inputSchema<number>()
      .store(memoryStore({}))
      .handle(async (value) => [recorded.create(value)])
    const eventLog = memoryEventLog()
    const schedulerFailure = new Error('scheduler unavailable')
    const brokenScheduler: ReactionScheduler = () => () => {
      throw schedulerFailure
    }
    const app = await createSpecterApp({
      events: [recorded],
      eventLog: eventLog.adapter,
      schedule: brokenScheduler,
      slices: [command],
    })

    const execution = await app.command({
      type: 'recordValue',
      payload: 1,
    })

    expect(eventLog.events).toHaveLength(1)
    await expect(execution.reactions).rejects.toMatchObject({
      code: 'SPECTER_INFRASTRUCTURE_FAILURE',
      cause: schedulerFailure,
    })
  })

  test('decodes Query results and Reaction effects exactly once', async () => {
    const sourceRecorded = createEventDefinition(
      'source-recorded',
      schema<{ value: number }, { value: number }>((payload) => payload),
    )
    const recordSource = createCommandSlice('recordSource')
      .description('Records a source value.')
      .scenarios({
        description: 'Records the supplied source value.',
        given: [],
        when: { value: 7 },
        expect: [event('source-recorded', { value: 7 })],
      })
      .inputSchema<{ value: number }>()
      .store(memoryStore({}))
      .handle(async (command) => [sourceRecorded.create(command)])
    const query = createQuerySlice('sourceLabel')
      .description('Reads a decoded source label.')
      .scenarios({
        description: 'Formats the recorded source.',
        given: [event('source-recorded', { value: 7 })],
        when: {},
        expect: { label: 'Value 7' },
      })
      .inputSchema<Record<string, never>>()
      .outputSchema(
        schema<{ value: number }, { label: string }>((result) => ({
          label: `Value ${result.value}`,
        })),
      )
      .store(memoryStore({ value: 0 }))
      .apply(sourceRecorded, async (applied, state) => {
        state.value = applied.payload.value
      })
      .handle(async (_input, state) => ({ value: state.value }))
    const reactionEffects: { value: number }[] = []
    const reaction = createReactionSlice('captureSource')
      .description('Captures a decoded reaction effect.')
      .scenarios({
        description: 'Transforms the raw effect before execution.',
        given: [event('source-recorded', { value: 7 })],
        expect: [{ value: 7 }],
      })
      .outputSchema(
        schema<{ rawValue: string }, { value: number }>((result) => ({
          value: Number(result.rawValue),
        })),
      )
      .plugin(async () => async (effect) => {
        reactionEffects.push(effect)
      })
      .store(memoryStore({ rawValue: '' }))
      .apply(sourceRecorded, async (applied, state) => {
        state.rawValue = String(applied.payload.value)
      })
      .handle(async (state) => ({ rawValue: state.rawValue }))
    const eventLog = memoryEventLog()
    const app = await createSpecterApp({
      events: [sourceRecorded],
      eventLog: eventLog.adapter,
      schedule: immediateScheduler,
      slices: [recordSource, query, reaction],
    })

    const execution = await app.command({
      type: 'recordSource',
      payload: { value: 7 },
    })
    await execution.reactions

    await expect(
      app.query({ type: 'sourceLabel', payload: {} }),
    ).resolves.toEqual({ label: 'Value 7' })
    expect(reactionEffects).toEqual([{ value: 7 }])
  })

  test('waits through Reaction-emitted Commands without self-deadlocking', async () => {
    const sourceRecorded = createEventDefinition(
      'source-recorded',
      schema<number, number>((value) => value),
    )
    const derivedRecorded = createEventDefinition(
      'derived-recorded',
      schema<number, number>((value) => value),
    )
    const sourceCommand = createCommandSlice('recordSource')
      .description('Records a source.')
      .scenarios({
        description: 'Records a source.',
        given: [],
        when: 3,
        expect: [event('source-recorded', 3)],
      })
      .inputSchema<number>()
      .store(memoryStore({}))
      .handle(async (value) => [sourceRecorded.create(value)])
    const derivedCommand = createCommandSlice('recordDerived')
      .description('Records a derived value.')
      .scenarios({
        description: 'Records a derived value.',
        given: [],
        when: 6,
        expect: [event('derived-recorded', 6)],
      })
      .inputSchema<number>()
      .store(memoryStore({}))
      .handle(async (value) => [derivedRecorded.create(value)])
    const reaction = createReactionSlice('deriveValue')
      .description('Derives another Command.')
      .scenarios({
        description: 'Requests the derived value.',
        given: [event('source-recorded', 3)],
        expect: [{ type: 'recordDerived', payload: 6 }],
      })
      .outputSchema<{ type: string; payload: number }>()
      .plugin(async (dispatch) => async (command, context) => {
        await dispatch(command, { idempotencyKey: context.deliveryId })
      })
      .store(memoryStore({ value: 0 }))
      .apply(sourceRecorded, async (applied, state) => {
        state.value = applied.payload
      })
      .handle(async (state) => ({
        type: 'recordDerived',
        payload: state.value * 2,
      }))
    const eventLog = memoryEventLog()
    const app = await createSpecterApp({
      events: [sourceRecorded, derivedRecorded],
      eventLog: eventLog.adapter,
      schedule: immediateScheduler,
      slices: [sourceCommand, derivedCommand, reaction],
    })

    const execution = await app.command({
      type: 'recordSource',
      payload: 3,
    })
    await execution.reactions

    expect(
      eventLog.events.map(({ type, payload }) => ({ type, payload })),
    ).toEqual([
      { type: 'source-recorded', payload: 3 },
      { type: 'derived-recorded', payload: 6 },
    ])
  })

  test('enforces expected Event Log version and idempotency semantics', async () => {
    const recorded = createEventDefinition(
      'value-recorded',
      schema<number, number>((value) => value),
    )
    const handle = vi.fn(async (value: number) => [recorded.create(value)])
    const command = createCommandSlice('recordValue')
      .description('Records a value.')
      .scenarios({
        description: 'Records a value.',
        given: [],
        when: 1,
        expect: [event('value-recorded', 1)],
      })
      .inputSchema<number>()
      .store(memoryStore({}))
      .handle(handle)
    const eventLog = memoryEventLog()
    const app = await createSpecterApp({
      events: [recorded],
      eventLog: eventLog.adapter,
      schedule: immediateScheduler,
      slices: [command],
    })

    const first = await app.command(
      { type: 'recordValue', payload: 1 },
      { expectedVersion: 0, idempotencyKey: 'request-1' },
    )
    const duplicate = await app.command(
      { type: 'recordValue', payload: 1 },
      { expectedVersion: 0, idempotencyKey: 'request-1' },
    )

    expect(first).toMatchObject({ version: 1, duplicate: false })
    expect(duplicate).toMatchObject({
      events: first.events,
      version: 1,
      duplicate: true,
    })
    expect(eventLog.events).toHaveLength(1)
    expect(handle).toHaveBeenCalledTimes(1)
    await expect(
      app.command(
        { type: 'recordValue', payload: 2 },
        { idempotencyKey: 'request-1' },
      ),
    ).rejects.toBeInstanceOf(SpecterIdempotencyConflictError)
    await expect(
      app.command({ type: 'recordValue', payload: 2 }, { expectedVersion: 0 }),
    ).rejects.toMatchObject({
      expectedVersion: 0,
      actualVersion: 1,
    } satisfies Partial<SpecterVersionConflictError>)
  })

  test('uses the decision version as append CAS without caller expectedVersion', async () => {
    const recorded = createEventDefinition(
      'value-recorded',
      schema<number, number>((value) => value),
    )
    const command = createCommandSlice('recordValue')
      .description('Records a value.')
      .scenarios({
        description: 'Records a value.',
        given: [],
        when: 1,
        expect: [event('value-recorded', 1)],
      })
      .inputSchema<number>()
      .store(memoryStore({}))
      .handle(async (value) => [recorded.create(value)])
    const eventLog = memoryEventLog()
    const append = eventLog.adapter.append
    let injectCompetingAppend = true
    eventLog.adapter.append = async (drafts, options) => {
      if (injectCompetingAppend) {
        injectCompetingAppend = false
        await append([{ type: 'value-recorded', payload: 99 }], {
          expectedVersion: 0,
        })
      }
      return append(drafts, options)
    }
    const app = await createSpecterApp({
      events: [recorded],
      eventLog: eventLog.adapter,
      schedule: immediateScheduler,
      slices: [command],
    })

    await expect(
      app.command({ type: 'recordValue', payload: 1 }),
    ).rejects.toMatchObject({
      expectedVersion: 0,
      actualVersion: 1,
    } satisfies Partial<SpecterVersionConflictError>)
    expect(eventLog.events.map((persisted) => persisted.payload)).toEqual([99])
  })

  test('preserves a duplicate discovered atomically during append', async () => {
    const sourceRecorded = createEventDefinition(
      'source-recorded',
      schema<number, number>((value) => value),
    )
    const handle = vi.fn(async (value: number) => [
      sourceRecorded.create(value),
    ])
    const command = createCommandSlice('recordSource')
      .description('Records a source.')
      .scenarios({
        description: 'Records a source.',
        given: [],
        when: 1,
        expect: [event('source-recorded', 1)],
      })
      .inputSchema<number>()
      .store(memoryStore({}))
      .handle(handle)
    const delivered = vi.fn(async () => undefined)
    const reaction = createReactionSlice('deliverSource')
      .description('Delivers a source once.')
      .scenarios({
        description: 'Delivers the source.',
        given: [event('source-recorded', 1)],
        expect: [1],
      })
      .outputSchema<number>()
      .plugin(async () => delivered)
      .store(stagedMemoryStore({ value: 0 }))
      .apply(sourceRecorded, async (applied, state) => {
        state.value = applied.payload
      })
      .handle(async (state) => state.value)
    const eventLog = memoryEventLog()
    const app = await createSpecterApp({
      events: [sourceRecorded],
      eventLog: eventLog.adapter,
      schedule: immediateScheduler,
      slices: [command, reaction],
    })
    const envelope = { type: 'recordSource', payload: 1 } as const
    const options = { idempotencyKey: 'atomic-request-1' } as const

    const first = await app.command(envelope, options)
    await first.reactions

    const findCommit = eventLog.adapter.findCommit
    let hideReceiptOnce = true
    eventLog.adapter.findCommit = async (idempotencyKey) => {
      if (hideReceiptOnce) {
        hideReceiptOnce = false
        return undefined
      }
      return findCommit(idempotencyKey)
    }
    const duplicate = await app.command(envelope, options)
    expect(duplicate.duplicate).toBe(true)
    await duplicate.reactions

    expect(eventLog.events).toHaveLength(1)
    expect(handle).toHaveBeenCalledTimes(2)
    expect(delivered).toHaveBeenCalledTimes(1)
  })

  test('reports validation and command rejection through stable error codes', async () => {
    const positiveSchema: StandardSchemaV1<number, number> = {
      '~standard': {
        version: 1,
        vendor: 'specter-core-test',
        validate: (value) =>
          typeof value === 'number' && value > 0
            ? { value }
            : { issues: [{ message: 'Expected a positive number.' }] },
      },
    }
    const recorded = createEventDefinition('value-recorded', positiveSchema)
    const command = createCommandSlice('recordValue')
      .description('Records a positive value.')
      .scenarios({
        description: 'Records a value.',
        given: [],
        when: 1,
        expect: [event('value-recorded', 1)],
      })
      .inputSchema(positiveSchema)
      .store(memoryStore({}))
      .handle(async (value) => {
        if (value === 2) throw new Error('two is unavailable')
        return [recorded.create(value)]
      })
    const query = createQuerySlice('invalidValue')
      .description('Returns an invalid implementation result.')
      .scenarios({
        description: 'Documents the public result.',
        given: [event('value-recorded', 1)],
        when: {},
        expect: 1,
      })
      .inputSchema<Record<string, never>>()
      .outputSchema(positiveSchema)
      .store(memoryStore({ value: 0 }))
      .apply(recorded, async (applied, state) => {
        state.value = applied.payload
      })
      .handle(async () => 0)
    const app = await createSpecterApp({
      events: [recorded],
      eventLog: memoryEventLog().adapter,
      schedule: immediateScheduler,
      slices: [command, query],
    })

    await expect(
      app.command({ type: 'recordValue', payload: 0 }),
    ).rejects.toMatchObject({ code: 'SPECTER_INVALID_INPUT' })
    await expect(
      app.command({ type: 'recordValue', payload: 2 }),
    ).rejects.toMatchObject({
      code: 'SPECTER_COMMAND_REJECTED',
      message: expect.stringContaining('two is unavailable'),
    })
    await expect(
      app.query({ type: 'invalidValue', payload: {} }),
    ).rejects.toMatchObject({ code: 'SPECTER_INVALID_OUTPUT' })
  })

  test('rejects malformed Event Log query ordering before applying state', async () => {
    const recorded = createEventDefinition(
      'value-recorded',
      schema<number, number>((value) => value),
    )
    const eventLog = memoryEventLog()
    eventLog.adapter.query = async () => [
      {
        type: 'value-recorded',
        payload: 2,
        id: 'event-2',
        recordedAt: '1970-01-01T00:00:00.000Z',
        order: 2,
      },
      {
        type: 'value-recorded',
        payload: 1,
        id: 'event-1',
        recordedAt: '1970-01-01T00:00:00.000Z',
        order: 1,
      },
    ]
    const query = createQuerySlice('latestValue')
      .description('Reads a value.')
      .scenarios({
        description: 'Reads a value.',
        given: [event('value-recorded', 1)],
        when: {},
        expect: 1,
      })
      .inputSchema<Record<string, never>>()
      .outputSchema<number>()
      .store(memoryStore({ value: 0 }))
      .apply(recorded, async (applied, state) => {
        state.value = applied.payload
      })
      .handle(async (_query, state) => state.value)
    const seedCommand = createCommandSlice('seedValue')
      .description('Provides Event coverage.')
      .scenarios({
        description: 'Seeds a value.',
        given: [],
        when: 1,
        expect: [event('value-recorded', 1)],
      })
      .inputSchema<number>()
      .store(memoryStore({}))
      .handle(async (value) => [recorded.create(value)])
    const app = await createSpecterApp({
      events: [recorded],
      eventLog: eventLog.adapter,
      schedule: immediateScheduler,
      slices: [seedCommand, query],
    })

    await expect(
      app.query({ type: 'latestValue', payload: {} }),
    ).rejects.toBeInstanceOf(SpecterEventLogOrderError)
  })

  test('never publishes a Slice cursor after a partially failed apply pass', async () => {
    const valueRecorded = createEventDefinition(
      'value-recorded',
      schema<number, number>((value) => value),
    )
    let published = { total: 0, cursor: 0 }
    let publishCalls = 0
    const stagedStore: SliceStoreAdapter<{ total: number }> = {
      async get() {
        const staged = { total: published.total }
        return {
          write: staged,
          read: staged,
          lastAppliedOrder: async () => published.cursor,
          setLastAppliedOrder: async (order) => {
            publishCalls += 1
            published = { total: staged.total, cursor: order }
          },
        }
      },
      async transaction(sliceName, run) {
        return run(await stagedStore.get(sliceName))
      },
    }
    const query = createQuerySlice('sumValues')
      .description('Sums values.')
      .scenarios({
        description: 'Sums recorded values.',
        given: [event('value-recorded', 1), event('value-recorded', 2)],
        when: {},
        expect: 3,
      })
      .inputSchema<Record<string, never>>()
      .outputSchema<number>()
      .store(stagedStore)
      .apply(valueRecorded, async (applied, state) => {
        state.total += applied.payload
        if (applied.payload === 2) throw new Error('apply failed')
      })
      .handle(async (_input, state) => state.total)
    const seed = createCommandSlice('seedValue')
      .description('Provides Event coverage.')
      .scenarios({
        description: 'Records a value.',
        given: [],
        when: 1,
        expect: [event('value-recorded', 1)],
      })
      .inputSchema<number>()
      .store(memoryStore({}))
      .handle(async (value) => [valueRecorded.create(value)])
    const eventLog = memoryEventLog([
      {
        type: 'value-recorded',
        payload: 1,
        id: 'event-1',
        recordedAt: '1970-01-01T00:00:00.000Z',
        order: 1,
      },
      {
        type: 'value-recorded',
        payload: 2,
        id: 'event-2',
        recordedAt: '1970-01-01T00:00:01.000Z',
        order: 2,
      },
    ])
    const app = await createSpecterApp({
      events: [valueRecorded],
      eventLog: eventLog.adapter,
      schedule: immediateScheduler,
      slices: [seed, query],
    })

    await expect(
      app.query({ type: 'sumValues', payload: {} }),
    ).rejects.toMatchObject({ code: 'SPECTER_INFRASTRUCTURE_FAILURE' })
    expect(published).toEqual({ total: 0, cursor: 0 })
    expect(publishCalls).toBe(0)
  })
})

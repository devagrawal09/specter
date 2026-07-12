import type { StandardSchemaV1 } from '@standard-schema/spec'
import { describe, expect, test } from 'vitest'

import type {
  CommandEnvelope,
  EventLogAdapter,
  PersistedEvent,
  ReactionScheduler,
  SliceStoreAdapter,
} from '..'
import {
  createCommandSlice,
  createEventDefinition,
  createQuerySlice,
  createReactionSlice,
  event,
} from '..'
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
): SliceStoreAdapter<TState> {
  let lastAppliedOrder = 0
  const adapter: SliceStoreAdapter<TState> = {
    async get() {
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
      return run(await adapter.get(sliceName))
    },
  }
  return adapter
}

function memoryEventLog() {
  let nextOrder = 1
  const events: PersistedEvent[] = []
  const adapter: EventLogAdapter = {
    async query(order, eventTypes) {
      return events.filter(
        (candidate) =>
          candidate.order > order && eventTypes.includes(candidate.type),
      )
    },
    async append(drafts) {
      const appended = drafts.map((draft) => ({
        ...draft,
        id: `event-${nextOrder}`,
        order: nextOrder++,
        recordedAt: new Date(0),
      }))
      events.push(...appended)
      return appended
    },
    transaction: (run) => run(adapter),
  }
  return { adapter, events }
}

const immediateScheduler: ReactionScheduler = (run) => () => {
  const active = run()
  return () => active
}

describe('createSpecterApp execution contracts', () => {
  test('awaits async conformance and rejects command Events not authorized by its scenarios', async () => {
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

    await expect(app.attemptUnauthorized({ value: 1 })).rejects.toThrow(
      'emitted unauthorized Event "unauthorized-event" at index 0',
    )
    expect(eventLog.events).toEqual([])
  })

  test('decodes query results and reaction effects through output schemas', async () => {
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
        expect: [
          {
            type: 'raw-source-effect',
            payload: { rawValue: '7' },
          },
        ],
      })
      .outputSchema(
        schema<
          CommandEnvelope<'raw-source-effect', { rawValue: string }>,
          { value: number }
        >((result) => ({ value: Number(result.payload.rawValue) })),
      )
      .plugin(async () => async (effect) => {
        reactionEffects.push(effect)
      })
      .store(memoryStore({ rawValue: '' }))
      .apply(sourceRecorded, async (applied, state) => {
        state.rawValue = String(applied.payload.value)
      })
      .handle(async (state) => ({
        type: 'raw-source-effect',
        payload: { rawValue: state.rawValue },
      }))
    const eventLog = memoryEventLog()
    const app = await createSpecterApp({
      events: [sourceRecorded],
      eventLog: eventLog.adapter,
      schedule: immediateScheduler,
      slices: [recordSource, query, reaction],
    })

    await app.recordSource({ value: 7 })

    await expect(app.sourceLabel({})).resolves.toEqual({ label: 'Value 7' })
    expect(reactionEffects).toEqual([{ value: 7 }])
  })
})

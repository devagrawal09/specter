import type { StandardSchemaV1 } from '@standard-schema/spec'

import type { CommandEnvelope, SliceStoreAdapter } from '..'
import { createEventDefinition } from '..'
import {
  createCommandSlice,
  createQuerySlice,
  createReactionSlice,
  event,
} from '../spec-entry'
import { testSliceImplementations } from './scenarios'

function identitySchema<T>(): StandardSchemaV1<T, T> {
  return {
    '~standard': {
      version: 1,
      vendor: 'specter-core-test',
      validate: (value) => ({ value: value as T }),
    },
  }
}

function memoryStore<TState extends object>(
  initialState: TState,
): SliceStoreAdapter<TState> {
  let state = structuredClone(initialState)
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

  return Object.assign(adapter, {
    reset() {
      state = structuredClone(initialState)
      lastAppliedOrder = 0
    },
  })
}

type RecordPayload = {
  id: string
  value: number
  occurredAt: string
}

const recordCreated = createEventDefinition(
  'record-created',
  identitySchema<RecordPayload>(),
)
const commandSpec = createCommandSlice('createRecord')
  .description('Creates a record with caller-supplied identity and time.')
  .scenarios({
    description: 'Preserves every supplied Event payload field exactly.',
    given: [],
    when: {
      id: 'record-42',
      value: 42,
      occurredAt: '2026-07-11T12:00:00.000Z',
    },
    expect: [
      event('record-created', {
        id: 'record-42',
        value: 42,
        occurredAt: '2026-07-11T12:00:00.000Z',
      }),
    ],
  })
const command = commandSpec
  .inputSchema(identitySchema<RecordPayload>())
  .store(memoryStore({}))
  .handle(async (input) => [recordCreated.create(input)])

const querySpec = createQuerySlice('recordDetails')
  .description('Reads exact record details.')
  .scenarios({
    description: 'Returns the complete replayed payload.',
    given: [
      event('record-created', {
        id: 'record-42',
        value: 42,
        occurredAt: '2026-07-11T12:00:00.000Z',
      }),
    ],
    when: { id: 'record-42' },
    expect: {
      id: 'record-42',
      value: 42,
      occurredAt: '2026-07-11T12:00:00.000Z',
    },
  })
const query = querySpec
  .inputSchema(identitySchema<{ id: string }>())
  .outputSchema(identitySchema<RecordPayload>())
  .store(
    memoryStore<RecordPayload>({
      id: '',
      value: 0,
      occurredAt: '',
    }),
  )
  .apply(recordCreated, async (applied, state) => {
    Object.assign(state, applied.payload)
  })
  .handle(async (_input, state) => ({ ...state }))

const reactionSpec = createReactionSlice('announceRecord')
  .description('Creates an exact follow-up command.')
  .scenarios({
    description: 'Carries identity and time into the reaction output.',
    given: [
      event('record-created', {
        id: 'record-42',
        value: 42,
        occurredAt: '2026-07-11T12:00:00.000Z',
      }),
    ],
    expect: [
      {
        type: 'sendAnnouncement',
        payload: {
          id: 'record-42',
          message: 'Record 42 created',
          occurredAt: '2026-07-11T12:00:00.000Z',
        },
      },
    ],
  })
const reaction = reactionSpec
  .outputSchema<CommandEnvelope>()
  .plugin(async () => async () => undefined)
  .store(
    memoryStore<RecordPayload>({
      id: '',
      value: 0,
      occurredAt: '',
    }),
  )
  .apply(recordCreated, async (applied, state) => {
    Object.assign(state, applied.payload)
  })
  .handle(async (state) => ({
    type: 'sendAnnouncement',
    payload: {
      id: state.id,
      message: `Record ${state.value} created`,
      occurredAt: state.occurredAt,
    },
  }))

testSliceImplementations([command, query, reaction], {
  events: [recordCreated],
  runScenario: async (run) => run(),
})

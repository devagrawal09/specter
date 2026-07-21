import type { StandardSchemaV1 } from '@standard-schema/spec'
import { describe, expect, it } from 'vitest'

import type { EventLogAdapter, EventLogCommit, SliceStoreAdapter } from '..'
import { createEventDefinition } from '..'
import { createCommandSlice, event } from '../spec-entry'
import { createSpecterAppFromFeatures, defineSpecterFeature } from './features'

const numberSchema: StandardSchemaV1<number> = {
  '~standard': {
    version: 1,
    vendor: 'specter-feature-test',
    validate: (value) => ({ value: value as number }),
  },
}

describe('app-scoped feature factories', () => {
  it('creates fresh Slice stores for every app', async () => {
    const recorded = createEventDefinition('value-recorded', numberSchema)
    const states: { total: number }[] = []
    const feature = defineSpecterFeature(() => {
      const state = { total: 0 }
      states.push(state)
      const command = createCommandSlice('recordValue')
        .description('Records a value.')
        .scenarios({
          description: 'Records one value.',
          given: [],
          when: 1,
          expect: [event('value-recorded', 1)],
        })
        .inputSchema<number>()
        .store(memoryStore(state))
        .handle(async (value) => [recorded.create(value)])
      return { events: [recorded], slices: [command] } as const
    })

    const first = await createSpecterAppFromFeatures({
      eventLog: memoryEventLog(),
      schedule: immediateScheduler,
      features: [feature],
    })
    const second = await createSpecterAppFromFeatures({
      eventLog: memoryEventLog(),
      schedule: immediateScheduler,
      features: [feature],
    })

    expect(states).toHaveLength(2)
    expect(states[0]).not.toBe(states[1])
    await Promise.all([first.close(), second.close()])
  })
})

const immediateScheduler =
  (run: Parameters<import('..').ReactionScheduler>[0]) => () => {
    const completion = run({
      deliveryId: 'test-pass',
      scheduledAt: new Date(0).toISOString(),
      attemptId: 'test-pass:attempt:1',
      attemptNumber: 1,
    })
    return () => completion
  }

function memoryStore<TState extends object>(
  state: TState,
): SliceStoreAdapter<TState> {
  let cursor = 0
  const store = {
    write: state,
    read: state,
    lastAppliedOrder: async () => cursor,
    setLastAppliedOrder: async (order: number) => {
      cursor = order
    },
  }
  return {
    get: async () => store,
    transaction: async (_sliceName, run) => run(store),
  }
}

function memoryEventLog(): EventLogAdapter {
  let version = 0
  const commits = new Map<string, EventLogCommit>()
  const adapter: EventLogAdapter = {
    query: async () => [],
    currentVersion: async () => version,
    findCommit: async (key) => commits.get(key),
    append: async (events, options = {}) => {
      const persisted = events.map((event) => ({
        ...event,
        id: `event-${++version}`,
        order: version,
        recordedAt: new Date(0).toISOString(),
      }))
      const commit = {
        events: persisted,
        version,
        idempotencyKey: options.idempotencyKey,
        fingerprint: options.fingerprint,
      }
      if (options.idempotencyKey) commits.set(options.idempotencyKey, commit)
      return { ...commit, duplicate: false }
    },
    transaction: (run) => run(adapter),
  }
  return adapter
}

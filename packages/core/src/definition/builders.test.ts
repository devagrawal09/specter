import type { StandardSchemaV1 } from '@standard-schema/spec'
import { describe, expect, test } from 'vitest'

import type { SliceStoreAdapter } from '../adapters'
import { createCommandSlice, createEventDefinition, event } from './index'

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

describe('Slice specifications', () => {
  test('freeze structural wrappers without cloning caller values and remain reusable', async () => {
    const countChanged = createEventDefinition(
      'count-changed',
      identitySchema<{ amount: number }>(),
    )
    const specification = createCommandSlice('changeCount')
      .description('Changes a count.')
      .scenarios({
        description: 'Changes the count by an exact amount.',
        given: [event('count-changed', { amount: 1 })],
        when: { amount: 2 },
        expect: [event('count-changed', { amount: 2 })],
      })

    const firstState = { count: 0 }
    const secondState = { count: 100 }
    const first = specification
      .inputSchema(identitySchema<{ amount: number }>())
      .store(memoryStore(firstState))
      .apply(countChanged, async (applied, state) => {
        state.count += applied.payload.amount
      })
      .handle(async (command) => [countChanged.create(command)])
    const second = specification
      .inputSchema(identitySchema<{ amount: number }>())
      .store(memoryStore(secondState))
      .apply(countChanged, async (applied, state) => {
        state.count -= applied.payload.amount
      })
      .handle(async (command) => [countChanged.create(command)])

    expect(specification.stage).toBe('specification')
    expect(Object.isFrozen(specification)).toBe(true)
    expect(Object.isFrozen(specification.scenarios)).toBe(true)
    expect(Object.isFrozen(specification.scenarios[0])).toBe(true)
    expect(Object.isFrozen(specification.scenarios[0].given)).toBe(true)
    expect(Object.isFrozen(specification.scenarios[0].expect)).toBe(true)
    expect(Object.isFrozen(specification.scenarios[0].when)).toBe(false)
    expect(
      Object.isFrozen(specification.scenarios[0].expect[0].examplePayload),
    ).toBe(false)
    expect(first).not.toBe(second)
    expect(first.scenarios).toBe(specification.scenarios)
    expect(second.scenarios).toBe(specification.scenarios)
    expect(first.apply).not.toBe(second.apply)

    const firstStore = await first.store.get(first.name)
    const secondStore = await second.store.get(second.name)
    await first.apply[0].handle(
      {
        type: 'count-changed',
        payload: { amount: 3 },
        id: 'first-event',
        recordedAt: '1970-01-01T00:00:00.000Z',
      },
      firstStore.write,
    )
    await second.apply[0].handle(
      {
        type: 'count-changed',
        payload: { amount: 3 },
        id: 'second-event',
        recordedAt: '1970-01-01T00:00:00.000Z',
      },
      secondStore.write,
    )

    expect(firstState.count).toBe(3)
    expect(secondState.count).toBe(97)
  })
})

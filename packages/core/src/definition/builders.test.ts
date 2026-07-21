import type { StandardSchemaV1 } from '@standard-schema/spec'
import { describe, expect, test } from 'vitest'

import { createTestSliceStore } from '../testing/test-slice-store'
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
    const firstStore = createTestSliceStore(firstState)
    const secondStore = createTestSliceStore(secondState)
    const first = specification
      .inputSchema(identitySchema<{ amount: number }>())
      .store(firstStore.tag)
      .apply(countChanged, async (applied, state) => {
        state.count += applied.payload.amount
      })
      .handle(async (command) => [countChanged.create(command)])
    const second = specification
      .inputSchema(identitySchema<{ amount: number }>())
      .store(secondStore.tag)
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

    await first.apply[0].handle(
      {
        type: 'count-changed',
        payload: { amount: 3 },
        id: 'first-event',
        recordedAt: '1970-01-01T00:00:00.000Z',
      },
      firstState,
    )
    await second.apply[0].handle(
      {
        type: 'count-changed',
        payload: { amount: 3 },
        id: 'second-event',
        recordedAt: '1970-01-01T00:00:00.000Z',
      },
      secondState,
    )

    expect(firstState.count).toBe(3)
    expect(secondState.count).toBe(97)
  })
})

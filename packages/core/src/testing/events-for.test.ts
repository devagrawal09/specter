import type { StandardSchemaV1 } from '@standard-schema/spec'
import { describe, expect, test } from 'vitest'

import type { SliceStoreAdapter } from '../adapters'
import { createEventDefinition } from '../definition'
import { createCommandSlice, event } from '../definition'
import { eventsFor } from './events-for'

const schema = {
  '~standard': {
    version: 1,
    vendor: 'specter-core-test',
    validate: (value: unknown) => ({ value }),
  },
} as StandardSchemaV1

function store(): SliceStoreAdapter<Record<string, never>> {
  const state = {}
  const adapter: SliceStoreAdapter<Record<string, never>> = {
    async get() {
      return {
        write: state,
        read: state,
        lastAppliedOrder: async () => 0,
        setLastAppliedOrder: async () => undefined,
      }
    },
    async transaction(sliceName, run) {
      return run(await adapter.get(sliceName))
    },
  }
  return adapter
}

describe('eventsFor', () => {
  test('selects focused Given/apply and Command outcome definitions', () => {
    const priorRecorded = createEventDefinition('prior-recorded', schema)
    const valueRecorded = createEventDefinition('value-recorded', schema)
    const unrelated = createEventDefinition('unrelated-recorded', schema)
    const command = createCommandSlice('recordValue')
      .description('Records a value.')
      .scenarios({
        description: 'Records after a prior value.',
        given: [event('prior-recorded', 1)],
        when: 2,
        expect: [event('value-recorded', 2)],
      })
      .inputSchema<number>()
      .store(store())
      .apply(priorRecorded, async () => undefined)
      .handle(async (value) => [valueRecorded.create(value)])

    expect(
      eventsFor(command, [unrelated, valueRecorded, priorRecorded]),
    ).toEqual([valueRecorded, priorRecorded])
  })

  test('explains exactly how to remediate a missing focused definition', () => {
    const valueRecorded = createEventDefinition('value-recorded', schema)
    const command = createCommandSlice('recordValue')
      .description('Records a value.')
      .scenarios({
        description: 'Records a value.',
        given: [],
        when: 1,
        expect: [event('value-recorded', 1)],
      })
      .inputSchema<number>()
      .store(store())
      .handle(async (value) => [valueRecorded.create(value)])

    expect(() => eventsFor(command, [])).toThrow(
      'Add the matching definition to the full app Event catalog',
    )
  })
})

import type { StandardSchemaV1 } from '@standard-schema/spec'
import { describe, expect, test } from 'vitest'

import { createEventDefinition } from '../definition'
import { createCommandSlice, event } from '../spec-entry'
import { eventsFor } from './events-for'
import { createTestSliceStore } from './test-slice-store'

const schema = {
  '~standard': {
    version: 1,
    vendor: 'specter-core-test',
    validate: (value: unknown) => ({ value }),
  },
} as StandardSchemaV1

const store = createTestSliceStore<Record<string, never>>({})

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
      .store(store.tag)
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
      .store(store.tag)
      .handle(async (value) => [valueRecorded.create(value)])

    expect(() => eventsFor(command, [])).toThrow(
      'Add the matching definition to the full app Event catalog',
    )
  })
})

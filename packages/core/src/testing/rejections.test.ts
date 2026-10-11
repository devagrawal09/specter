import type { StandardSchemaV1 } from '@standard-schema/spec'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { CommandRejection, createEventDefinition } from '..'
import {
  assertConforms,
  createCommandSlice,
  event,
  type ScenarioRejection,
} from '../definition'
import { checkCommandScenario } from './scenarios'
import { createTestSliceStore } from './test-slice-store'

function schema<T>(): StandardSchemaV1<T, T> {
  return {
    '~standard': {
      version: 1,
      vendor: 'specter-rejections-test',
      validate: (value) => ({ value: value as T }),
    },
  }
}

const valueRecorded = createEventDefinition('value-recorded', schema<number>())
const store = createTestSliceStore({})
const runScenario = <T>(program: Effect.Effect<T, unknown, unknown>) =>
  Effect.runPromise(
    program.pipe(Effect.provide(store.layer)) as Effect.Effect<T>,
  )

function recordValue(reject: ScenarioRejection, thrown: () => Error) {
  const slice = createCommandSlice('recordValue')
    .description('Records a positive value.')
    .scenarios(
      {
        description: 'Records a positive value.',
        given: [],
        when: 1,
        expect: [event('value-recorded', 1)],
      },
      {
        description: 'Refuses a negative value.',
        given: [],
        when: -1,
        expect: [],
        reject,
      },
    )
    .inputSchema<number>()
    .store(store.tag)
    .handle(async (value) => {
      if (value < 0) throw thrown()
      return [valueRecorded.create(value)]
    })
  return (() =>
    checkCommandScenario(
      slice,
      slice.scenarios[1],
      [valueRecorded],
      runScenario,
    ))()
}

const negative = () =>
  new CommandRejection('value-negative', 'Value must be positive', {
    value: -1,
  })

describe('rejected Command Scenarios', () => {
  it('match the code, and the message and details they state', async () => {
    await recordValue({ code: 'value-negative' }, negative)
    await recordValue(
      {
        code: 'value-negative',
        message: 'Value must be positive',
        details: { value: -1 },
      },
      negative,
    )
  })

  it('fail on another code, message or details', async () => {
    await expect(
      recordValue({ code: 'value-zero' }, negative),
    ).rejects.toThrow()
    await expect(
      recordValue({ code: 'value-negative', message: 'Too small' }, negative),
    ).rejects.toThrow()
    await expect(
      recordValue({ code: 'value-negative', details: { value: -2 } }, negative),
    ).rejects.toThrow()
  })

  it('fail when the handler throws anything but a CommandRejection', async () => {
    await expect(
      recordValue(
        { code: 'value-negative' },
        () => new Error('Value must be positive'),
      ),
    ).rejects.toThrow(/a handler rejects by throwing a CommandRejection/)
  })
})

describe('rejection codes in conformance', () => {
  it('reports a rejected Scenario without a kebab-case code', async () => {
    const slice = createCommandSlice('recordValue')
      .description('Records a positive value.')
      .scenarios(
        {
          description: 'Records a positive value.',
          given: [],
          when: 1,
          expect: [event('value-recorded', 1)],
        },
        {
          description: 'Refuses a negative value.',
          given: [],
          when: -1,
          expect: [],
          reject: { code: 'Value negative' },
        },
      )
      .inputSchema<number>()
      .store(store.tag)
      .handle(async (value) => [valueRecorded.create(value)])
    const failure = await Effect.runPromise(
      Effect.flip(
        assertConforms({
          events: [valueRecorded],
          slices: { recordValue: slice },
        }),
      ),
    )
    expect(failure.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'rejection-code',
    ])
  })
})

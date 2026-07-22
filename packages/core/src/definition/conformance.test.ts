import type { StandardSchemaV1 } from '@standard-schema/spec'
import { describe, expect, test } from 'vitest'
import { Effect } from 'effect'

import { createTestSliceStore } from '../testing/test-slice-store'
import {
  assertConforms,
  collectConformanceDiagnostics,
  createCommandSlice,
  createEventDefinition,
  createQuerySlice,
  createReactionSlice,
  event,
  type SpecterConformanceError,
} from './index'

function schema<TInput, TOutput>(
  decode: (input: TInput) => TOutput,
): StandardSchemaV1<TInput, TOutput> {
  return {
    '~standard': {
      version: 1,
      vendor: 'specter-core-test',
      validate: (value) => ({ value: decode(value as TInput) }),
    },
  }
}

describe('conformance diagnostics', () => {
  test('aggregate payload preservation and exact Given/apply parity failures', async () => {
    const givenOnly = createEventDefinition(
      'given-only',
      schema<{ value: number }, { value: number }>((payload) => payload),
    )
    const applyOnly = createEventDefinition(
      'apply-only',
      schema<{ value: number }, { value: number }>((payload) => payload),
    )
    const transformed = createEventDefinition(
      'payload-transformed',
      schema<
        { value: number; generatedAt: string },
        { value: number; generatedAt: string }
      >((payload) => ({
        value: payload.value,
        generatedAt: 'generated-by-schema',
      })),
    )

    const specification = createCommandSlice('recordValue')
      .description('Records a value.')
      .scenarios({
        description: 'Records the exact supplied fact.',
        given: [event('given-only', { value: 1 })],
        when: { value: 2 },
        expect: [
          event('payload-transformed', {
            value: 2,
            generatedAt: 'supplied-before-command',
          }),
        ],
      })
    const implementation = specification
      .inputSchema<{ value: number }>()
      .store(createTestSliceStore({ value: 0 }).tag)
      .apply(applyOnly, async (applied, state) => {
        state.value = applied.payload.value
      })
      .handle(async (command) => [
        transformed.create({
          value: command.value,
          generatedAt: 'supplied-before-command',
        }),
      ])
    const input = {
      events: [givenOnly, applyOnly, transformed],
      slices: [implementation],
    }

    const diagnostics = await Effect.runPromise(
      collectConformanceDiagnostics(input),
    )

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'event-payload-transformation',
          sliceName: 'recordValue',
          scenarioDescription: 'Records the exact supplied fact.',
          location: 'expect[0]',
          eventType: 'payload-transformed',
        }),
        expect.objectContaining({
          code: 'missing-apply-handler',
          sliceName: 'recordValue',
          eventType: 'given-only',
        }),
        expect.objectContaining({
          code: 'extra-apply-handler',
          sliceName: 'recordValue',
          eventType: 'apply-only',
        }),
      ]),
    )

    const result = await Effect.runPromise(Effect.result(assertConforms(input)))
    expect(result._tag).toBe('Failure')
    if (result._tag === 'Success')
      throw new Error('conformance unexpectedly passed')
    const failure: SpecterConformanceError = result.failure
    expect(failure).toMatchObject({
      _tag: 'SpecterConformanceError',
      name: 'SpecterConformanceError',
      diagnostics,
      errors: expect.arrayContaining([
        expect.any(Error),
        expect.any(Error),
        expect.any(Error),
      ]),
    } satisfies Partial<SpecterConformanceError>)
  })

  test('accepts exact payload decoding and equal Given/apply Event type unions', async () => {
    const valueRecorded = createEventDefinition(
      'value-recorded',
      schema<{ value: number }, { value: number }>((payload) => ({
        value: payload.value,
      })),
    )
    const implementation = createCommandSlice('recordValue')
      .description('Records a value.')
      .scenarios({
        description: 'Records after an earlier value.',
        given: [event('value-recorded', { value: 1 })],
        when: { value: 2 },
        expect: [event('value-recorded', { value: 2 })],
      })
      .inputSchema<{ value: number }>()
      .store(createTestSliceStore({ value: 0 }).tag)
      .apply(valueRecorded, async (applied, state) => {
        state.value = applied.payload.value
      })
      .handle(async (command) => [valueRecorded.create(command)])

    await expect(
      Effect.runPromise(
        collectConformanceDiagnostics({
          events: [valueRecorded],
          slices: [implementation],
        }),
      ),
    ).resolves.toEqual([])
  })

  test('allows implementation-level conformance without a Command Slice', async () => {
    const valueRecorded = createEventDefinition(
      'value-recorded',
      schema<{ value: number }, { value: number }>((payload) => payload),
    )
    const query = createQuerySlice('readValue')
      .description('Reads a value.')
      .scenarios({
        description: 'Reads the latest value.',
        given: [event('value-recorded', { value: 1 })],
        when: {},
        expect: 1,
      })
      .inputSchema<Record<string, never>>()
      .outputSchema<number>()
      .store(createTestSliceStore({ value: 0 }).tag)
      .apply(valueRecorded, async (applied, state) => {
        state.value = applied.payload.value
      })
      .handle(async (_input, state) => state.value)

    await expect(
      Effect.runPromise(
        assertConforms(
          { events: [valueRecorded], slices: [query] },
          { requireCommandSlice: false },
        ),
      ),
    ).resolves.toBeUndefined()
    await expect(
      Effect.runPromise(
        assertConforms({ events: [valueRecorded], slices: [query] }),
      ),
    ).rejects.toMatchObject({
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'missing-command-slice' }),
      ]),
    })
  })

  test('accepts default same-app Command Reaction without explicit Plugin', async () => {
    const valueRecorded = createEventDefinition(
      'value-recorded',
      schema<number, number>((value) => value),
    )
    const command = createCommandSlice('recordValue')
      .description('Records one value.')
      .scenarios({
        description: 'Records one value.',
        given: [],
        when: 1,
        expect: [event('value-recorded', 1)],
      })
      .inputSchema<number>()
      .store(createTestSliceStore({}).tag)
      .handle(async (value) => [valueRecorded.create(value)])
    const reaction = createReactionSlice('repeatValue')
      .description('Repeats latest value through same-app Command.')
      .scenarios({
        description: 'Repeats one value.',
        given: [event('value-recorded', 1)],
        expect: [{ type: 'recordValue', payload: 1 }],
      })
      .outputSchema<{ type: 'recordValue'; payload: number }>()
      .store(createTestSliceStore({ value: 0 }).tag)
      .apply(valueRecorded, async (applied, state) => {
        state.value = applied.payload
      })
      .handle(async (state) => ({
        type: 'recordValue',
        payload: state.value,
      }))

    expect(reaction.plugin).toBeUndefined()
    await expect(
      Effect.runPromise(
        assertConforms({
          events: [valueRecorded],
          slices: [command, reaction],
        }),
      ),
    ).resolves.toBeUndefined()
  })

  test('requires lower camel case Slice names', async () => {
    const valueRecorded = createEventDefinition(
      'value-recorded',
      schema<number, number>((value) => value),
    )
    const implementation = createCommandSlice('__proto__')
      .description('Uses an invalid operation identifier.')
      .scenarios({
        description: 'Records a value.',
        given: [],
        when: 1,
        expect: [event('value-recorded', 1)],
      })
      .inputSchema<number>()
      .store(createTestSliceStore({}).tag)
      .handle(async (value) => [valueRecorded.create(value)])

    await expect(
      Effect.runPromise(
        assertConforms({
          events: [valueRecorded],
          slices: [implementation],
        }),
      ),
    ).rejects.toMatchObject({
      code: 'SPECTER_CONFORMANCE_FAILED',
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          code: 'slice-name-format',
          sliceName: '__proto__',
        }),
      ]),
    })
  })

  test('treats Query expectations as final public values after transformation', async () => {
    const valueRecorded = createEventDefinition(
      'value-recorded',
      schema<number, number>((value) => value),
    )
    const query = createQuerySlice('valueLabel')
      .description('Formats a value.')
      .scenarios({
        description: 'Uses the public label in expect.',
        given: [event('value-recorded', 1)],
        when: {},
        expect: 'Value 1',
      })
      .inputSchema<Record<string, never>>()
      .outputSchema(
        schema<{ value: number }, string>(({ value }) => `Value ${value}`),
      )
      .store(createTestSliceStore({ value: 0 }).tag)
      .apply(valueRecorded, async (applied, state) => {
        state.value = applied.payload
      })
      .handle(async (_input, state) => ({ value: state.value }))

    await expect(
      Effect.runPromise(
        assertConforms(
          { events: [valueRecorded], slices: [query] },
          { requireCommandSlice: false },
        ),
      ),
    ).resolves.toBeUndefined()
  })

  test('reports invalid eager Store configuration as typed conformance data', async () => {
    const query = createQuerySlice('readValue')
      .description('Reads a value.')
      .scenarios({
        description: 'Reads empty state.',
        given: [],
        when: {},
        expect: 0,
      })
      .inputSchema<Record<string, never>>()
      .outputSchema<number>()
      .store(createTestSliceStore({ value: 0 }).tag)
      .handle(async (_input, state) => state.value)
    const malformed = { ...query, eager: 'yes' }

    const diagnostics = await Effect.runPromise(
      collectConformanceDiagnostics(
        { events: [], slices: [malformed as never] },
        { requireCommandSlice: false },
      ),
    )
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'invalid-store-eager',
        sliceName: 'readValue',
      }),
    )
  })
})

import { describe, expect, it } from 'vitest'

import type { EventDraft } from './event'
import type { SliceRegistration } from './slice'
import type {
  CommandScenario,
  QueryScenario,
  ReactionScenario,
} from './testing'
import { decideCommand, querySlice, reactToScenario } from './testing'

export type ScenarioTestOptions = {
  runScenario?: <T>(run: () => Promise<T>) => Promise<T>
}

export function testScenarios(
  registrations: readonly SliceRegistration[],
  options: ScenarioTestOptions = {},
) {
  const runScenario = options.runScenario ?? ((run) => run())

  for (const registration of registrations) {
    if (!registration.scenarios) {
      continue
    }

    const scenarios = registration.scenarios

    describe(registration.description, () => {
      switch (registration.kind) {
        case 'command':
          for (const scenario of scenarios) {
            if (!isCommandScenario(scenario)) {
              continue
            }
            testCommandScenario(registration, scenario, runScenario)
          }
          break
        case 'query':
          for (const scenario of scenarios) {
            if (!isQueryScenario(scenario)) {
              continue
            }
            testQueryScenario(registration, scenario, runScenario)
          }
          break
        case 'reaction':
          for (const scenario of scenarios) {
            if (!isReactionScenario(scenario)) {
              continue
            }
            testReactionScenario(registration, scenario, runScenario)
          }
          break
      }
    })
  }
}

function testCommandScenario(
  registration: Extract<SliceRegistration, { kind: 'command' }>,
  scenario: CommandScenario,
  runScenario: <T>(run: () => Promise<T>) => Promise<T>,
) {
  it(scenario.description, async () => {
    const result = await runScenario(async () => {
      try {
        return {
          _tag: 'Right' as const,
          right: await decideCommand(registration, scenario),
        }
      } catch (error) {
        return { _tag: 'Left' as const, left: error }
      }
    })

    if (scenario.expect.length === 0) {
      expect(result._tag).toBe('Left')
      if (scenario.reject) {
        if (result._tag !== 'Left') {
          throw new Error('Command scenario did not reject')
        }
        expect(result.left).toBeInstanceOf(Error)
        expect(result.left).toMatchObject({
          message: scenario.reject.reason,
        })
      }
      return
    }

    if (result._tag === 'Left') {
      throw new Error('Command scenario rejected unexpectedly')
    }

    expect(result.right).toHaveLength(scenario.expect.length)

    for (const [index, expectedEvent] of scenario.expect.entries()) {
      if (!isEvent(expectedEvent)) {
        throw new Error('Command scenario expected value is not an event')
      }

      const actualEvent = result.right[index]

      expect(actualEvent).toEqual(
        expect.objectContaining({
          type: expectedEvent.type,
        }),
      )
      expect(payloadWithoutIds(actualEvent?.payload)).toEqual(
        payloadWithoutIds(expectedEvent.payload),
      )
    }
  })
}

function testQueryScenario(
  registration: Extract<SliceRegistration, { kind: 'query' }>,
  scenario: QueryScenario,
  runScenario: <T>(run: () => Promise<T>) => Promise<T>,
) {
  it(scenario.description, async () => {
    const result = await runScenario(() => querySlice(registration, scenario))

    expect(result).toEqual(scenario.expect)
  })
}

function testReactionScenario(
  registration: Extract<SliceRegistration, { kind: 'reaction' }>,
  scenario: ReactionScenario,
  runScenario: <T>(run: () => Promise<T>) => Promise<T>,
) {
  it(scenario.description, async () => {
    const result = await runScenario(() =>
      reactToScenario(registration, scenario),
    )

    expect(result).toEqual(scenario.expect)
  })
}

function isCommandScenario(value: unknown): value is CommandScenario {
  return hasDescription(value) && hasGivenExpectArray(value) && 'when' in value
}

function isQueryScenario(value: unknown): value is QueryScenario {
  return (
    hasDescription(value) &&
    hasGiven(value) &&
    'when' in value &&
    'expect' in value
  )
}

function isReactionScenario(value: unknown): value is ReactionScenario {
  return hasDescription(value) && hasGivenExpectArray(value)
}

function hasDescription(value: unknown): value is { description: string } {
  return (
    value !== null &&
    typeof value === 'object' &&
    'description' in value &&
    typeof value.description === 'string'
  )
}

function hasGiven(value: unknown): value is { given: readonly unknown[] } {
  return (
    value !== null &&
    typeof value === 'object' &&
    'given' in value &&
    Array.isArray(value.given)
  )
}

function hasGivenExpectArray(
  value: unknown,
): value is { given: readonly unknown[]; expect: readonly unknown[] } {
  return hasGiven(value) && 'expect' in value && Array.isArray(value.expect)
}

function isEvent(value: unknown): value is EventDraft {
  return (
    value !== null &&
    typeof value === 'object' &&
    'type' in value &&
    'payload' in value &&
    typeof value.type === 'string'
  )
}

function payloadWithoutIds(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(payloadWithoutIds)
  }

  if (!isPlainObject(value)) {
    return value
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !isIdentifierKey(key))
      .map(([key, nested]) => [key, payloadWithoutIds(nested)]),
  )
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    return false
  }

  const prototype = Object.getPrototypeOf(value)

  return prototype === Object.prototype || prototype === null
}

function isIdentifierKey(key: string) {
  return (
    key === 'id' ||
    key === 'ID' ||
    key.endsWith('Id') ||
    key.endsWith('ID') ||
    key.endsWith('_id') ||
    key.endsWith('_ID')
  )
}

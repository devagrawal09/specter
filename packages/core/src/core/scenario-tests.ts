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

  describe('lib command scenarios', () => {
    for (const registration of registrations) {
      if (registration.kind !== 'command' || !registration.scenarios) {
        continue
      }

      const scenarios = registration.scenarios

      describe(registration.name, () => {
        for (const scenario of scenarios) {
          if (!isCommandScenario(scenario)) {
            continue
          }

          it(commandScenarioLabel(scenario), async () => {
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
                throw new Error(
                  'Command scenario expected value is not an event',
                )
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
      })
    }
  })

  describe('lib query scenarios', () => {
    for (const registration of registrations) {
      if (registration.kind !== 'query' || !registration.scenarios) {
        continue
      }

      const scenarios = registration.scenarios

      describe(registration.name, () => {
        for (const scenario of scenarios) {
          if (!isQueryScenario(scenario)) {
            continue
          }

          it(queryScenarioLabel(scenario), async () => {
            const result = await runScenario(() =>
              querySlice(registration, scenario),
            )

            expect(result).toEqual(scenario.expect)
          })
        }
      })
    }
  })

  describe('lib reaction scenarios', () => {
    for (const registration of registrations) {
      if (registration.kind !== 'reaction' || !registration.scenarios) {
        continue
      }

      const scenarios = registration.scenarios

      describe(registration.name, () => {
        for (const scenario of scenarios) {
          if (!isReactionScenario(scenario)) {
            continue
          }

          it(reactionScenarioLabel(scenario), async () => {
            const result = await runScenario(() =>
              reactToScenario(registration, scenario),
            )

            expect(result).toEqual(scenario.expect)
          })
        }
      })
    }
  })
}

function isCommandScenario(value: unknown): value is CommandScenario {
  return hasGivenExpectArray(value) && 'when' in value
}

function isQueryScenario(value: unknown): value is QueryScenario {
  return hasGiven(value) && 'when' in value && 'expect' in value
}

function isReactionScenario(value: unknown): value is ReactionScenario {
  return hasGivenExpectArray(value)
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

function commandScenarioLabel(scenario: CommandScenario) {
  const expectedTypes = scenario.expect
    .map((event) => (isEvent(event) ? event.type : 'unknown'))
    .join(', ')

  return [
    `given ${scenario.given.length} event(s)`,
    'when command runs',
    `then ${expectedTypes || 'no events'}`,
  ].join(', ')
}

function queryScenarioLabel(scenario: QueryScenario) {
  return [
    `given ${scenario.given.length} event(s)`,
    'when query input is applied',
    'then expected query state is returned',
  ].join(', ')
}

function reactionScenarioLabel(scenario: ReactionScenario) {
  const expectedTypes = scenario.expect
    .map((payload) => payload.type)
    .join(', ')

  return [
    `given ${scenario.given.length} event(s)`,
    'when reaction state advances',
    `then ${expectedTypes || 'no commands'}`,
  ].join(', ')
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

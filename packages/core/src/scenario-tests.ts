import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { Effect } from 'effect'
import * as Either from 'effect/Either'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { EventDraft } from './event'
import { createSpecterAppRuntimeLayer } from './layers'
import { CommandRejectedError } from './registry'
import type { EventLogService, SliceStores } from './services'
import type { SliceRegistration } from './slice'
import type {
  CommandScenario,
  QueryScenario,
  ReactionScenario,
} from './testing'
import { decideCommand, querySlice, reactToScenario } from './testing'

export type ScenarioTestOptions = {
  migrationsFolder?: string
}

export function testScenarios(
  registrations: readonly SliceRegistration[],
  options: ScenarioTestOptions = {},
) {
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
            const result = await runWithTestDb(
              decideCommand(registration, scenario).pipe(Effect.either),
              options,
            )

            if (scenario.expect.length === 0) {
              expect(Either.isLeft(result)).toBe(true)
              if (scenario.reject) {
                if (!Either.isLeft(result)) {
                  throw new Error('Command scenario did not reject')
                }
                expect(result.left).toBeInstanceOf(CommandRejectedError)
                expect(result.left).toMatchObject({
                  reason: scenario.reject.reason,
                })
              }
              return
            }

            if (Either.isLeft(result)) {
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
              expect(actualEvent?.payload).toEqual(
                comparablePayload(expectedEvent),
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
            const result = await runWithTestDb(
              querySlice(registration, scenario),
              options,
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
            const result = await runWithTestDb(
              reactToScenario(registration, scenario),
              options,
            )

            expect(result).toEqual(scenario.expect)
          })
        }
      })
    }
  })
}

async function runWithTestDb<T>(
  effect: Effect.Effect<T, unknown, EventLogService | SliceStores>,
  options: ScenarioTestOptions,
) {
  const directory = mkdtempSync(join(tmpdir(), 'specter-lib-'))
  const sqliteFilename = join(directory, 'test.sqlite')
  const sqlite = new Database(sqliteFilename)

  try {
    try {
      const db = drizzle(sqlite)
      migrate(db, {
        migrationsFolder:
          options.migrationsFolder ?? join(process.cwd(), 'drizzle'),
      })
    } finally {
      sqlite.close()
    }

    return await Effect.runPromise(
      effect.pipe(
        Effect.provide(createSpecterAppRuntimeLayer({ sqliteFilename })),
      ),
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
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

function comparablePayload(event: EventDraft) {
  if (isGeneratedTodoEvent(event)) {
    return expect.objectContaining({
      todoId: expect.any(String),
      title: event.payload.title,
    })
  }

  return event.payload
}

function isGeneratedTodoEvent(
  event: EventDraft,
): event is EventDraft<string, { todoId: 'generated'; title: unknown }> {
  const payload = event.payload

  return (
    event.type === 'todoAdded' &&
    payload !== null &&
    typeof payload === 'object' &&
    'todoId' in payload &&
    payload.todoId === 'generated' &&
    'title' in payload
  )
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

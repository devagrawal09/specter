import { describe, expect, it } from 'vitest'

import { applyEvents, decideCommand, sliceRegistrations } from './registry'
import type { CommandScenario } from './registry.builders'
import type { Event } from '../features/events'
import { createTestDb } from './test-db'

describe('command scenarios', () => {
  for (const registration of sliceRegistrations) {
    if (registration.kind !== 'command' || !registration.scenarios) {
      continue
    }

    const commandType = registration.type
    const scenarios = registration.scenarios

    describe(commandType, () => {
      for (const scenario of scenarios) {
        it(scenarioLabel(scenario), () => {
          const { db, sqlite } = createTestDb()

          try {
            applyEvents([...scenario.given], db)

            const result = decideCommand(
              { type: commandType, payload: scenario.when },
              db,
            )

            expect(result).toHaveLength(scenario.expect.length)

            for (const [index, expectedEvent] of scenario.expect.entries()) {
              expect(result[index]).toEqual(
                expect.objectContaining({
                  id: expect.any(String),
                  type: expectedEvent.type,
                  payload: expect.objectContaining(
                    comparablePayload(expectedEvent),
                  ),
                }),
              )
            }
          } finally {
            sqlite.close()
          }
        })
      }
    })
  }
})

function comparablePayload(event: Event) {
  if (event.type === 'todoAdded' && event.payload.todoId === 'generated') {
    return { title: event.payload.title }
  }

  return event.payload
}

function scenarioLabel(scenario: CommandScenario) {
  const expectedTypes = scenario.expect.map(({ type }) => type).join(', ')

  return [
    `given ${scenario.given.length} event(s)`,
    'when command runs',
    `then ${expectedTypes || 'no events'}`,
  ].join(', ')
}

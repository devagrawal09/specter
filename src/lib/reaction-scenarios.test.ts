import { describe, expect, it } from 'vitest'

import { applyEvents, sliceRegistrations } from './registry'
import type { ReactionScenario } from './registry.builders'
import { createTestDb } from './test-db'

describe('todo reaction scenarios', () => {
  for (const registration of sliceRegistrations) {
    if (registration.kind !== 'reaction' || !registration.scenarios) {
      continue
    }

    const reactionName = registration.name
    const scenarios = registration.scenarios

    describe(reactionName, () => {
      for (const scenario of scenarios) {
        it(scenarioLabel(scenario), () => {
          const { db, sqlite } = createTestDb()

          try {
            applyEvents([...scenario.given], db)

            const result = registration.react(scenario.when, db)

            expect(result).toEqual([...scenario.expect])
          } finally {
            sqlite.close()
          }
        })
      }
    })
  }
})

function scenarioLabel(scenario: ReactionScenario) {
  const expectedTypes = scenario.expect.map(({ type }) => type).join(', ')

  return [
    `given ${scenario.given.length} event(s)`,
    `when ${scenario.when.type}`,
    `then ${expectedTypes || 'no commands'}`,
  ].join(', ')
}

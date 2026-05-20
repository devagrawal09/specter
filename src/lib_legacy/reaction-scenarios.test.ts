import { describe, expect, it } from 'vitest'

import { registry } from './registry'
import type { ReactionScenario } from './registry.builders'
import { createTestRuntime } from './test-db'

describe('reaction scenarios', () => {
  for (const registration of registry.sliceRegistrations) {
    if (registration.kind !== 'reaction' || !registration.scenarios) {
      continue
    }

    const reactionName = registration.name
    const scenarios = registration.scenarios

    describe(reactionName, () => {
      for (const scenario of scenarios) {
        it(scenarioLabel(scenario), () => {
          const { runtime, sqlite } = createTestRuntime()

          try {
            registry.applyEvents([...scenario.given, scenario.when], runtime)

            const result = registry.reactToEvent(
              registration,
              scenario.when,
              runtime,
            )

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

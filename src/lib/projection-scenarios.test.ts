import { describe, expect, it } from 'vitest'

import { registry } from './registry'
import type {
  AnyProjectionRegistration,
  ProjectionScenario,
} from './registry.builders'
import { createTestRuntime } from './test-db'

describe('projection scenarios', () => {
  for (const registration of registry.sliceRegistrations) {
    if (registration.kind !== 'projection' || !registration.scenarios) {
      continue
    }

    const projection = registration as AnyProjectionRegistration
    const scenarios = projection.scenarios

    if (!scenarios) {
      continue
    }

    describe(projection.name, () => {
      for (const scenario of scenarios) {
        it(scenarioLabel(scenario), () => {
          const { runtime, sqlite } = createTestRuntime()

          try {
            registry.applyEvents([...scenario.given], runtime)

            const projectionInput = projection.schema.parse(scenario.when)
            const result = registry.queryProjection(
              projection,
              projectionInput,
              runtime,
            )

            expect(result).toEqual(scenario.expect)
          } finally {
            sqlite.close()
          }
        })
      }
    })
  }
})

function scenarioLabel(scenario: ProjectionScenario) {
  return [
    `given ${scenario.given.length} event(s)`,
    'when projection input is applied',
    'then expected query state is returned',
  ].join(', ')
}

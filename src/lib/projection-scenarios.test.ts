import { describe, expect, it } from 'vitest'
import type { z } from 'zod'

import { applyEvents, sliceRegistrations } from './registry'
import type {
  ProjectionRegistration,
  ProjectionScenario,
} from './registry.builders'
import { createTestDb } from './test-db'

describe('todo projection scenarios', () => {
  for (const registration of sliceRegistrations) {
    if (registration.kind !== 'projection' || !registration.scenarios) {
      continue
    }

    const projection = registration as ProjectionRegistration<
      string,
      z.ZodType,
      unknown
    >
    const scenarios = projection.scenarios

    if (!scenarios) {
      continue
    }

    describe(projection.name, () => {
      for (const scenario of scenarios) {
        it(scenarioLabel(scenario), () => {
          const { db, sqlite } = createTestDb()

          try {
            applyEvents([...scenario.given], db)

            const projectionInput = projection.schema.parse(scenario.when)
            const result = projection.query(db, projectionInput)

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

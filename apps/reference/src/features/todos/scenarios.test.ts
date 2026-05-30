import { testScenarios } from '@specter-ts/core/testing'

import { sqliteScenario } from '../../db/scenario-tests'
import { todoRegistrations } from './registry'

testScenarios(todoRegistrations, {
  runScenario: sqliteScenario({}),
})

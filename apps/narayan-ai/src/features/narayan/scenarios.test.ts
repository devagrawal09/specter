import { testScenarios } from '@specter-ts/core/testing'

import { sqliteScenario } from '../../db/scenario-tests'
import { narayanRegistrations } from './registry'

testScenarios(narayanRegistrations, {
  runScenario: sqliteScenario({}),
})

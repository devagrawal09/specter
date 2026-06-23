import { testScenarios } from '@specter-ts/core/testing'

import { sqliteScenario } from '../../db/scenario-tests'
import { chatRegistrations } from './registry'

testScenarios(chatRegistrations, {
  runScenario: sqliteScenario,
})

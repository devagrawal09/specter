import { testScenarios } from '@specter-ts/core/testing'

import { sqliteScenario } from '../../../db/scenario-tests'
import runRequestedAgentRun from './slice'

testScenarios([runRequestedAgentRun], {
  runScenario: sqliteScenario,
})

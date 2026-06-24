import { testScenarios } from '@specter-ts/core/testing'

import { sqliteScenario } from '../../../db/scenario-tests'
import revertSession from './slice'

testScenarios([revertSession], {
  runScenario: sqliteScenario,
})

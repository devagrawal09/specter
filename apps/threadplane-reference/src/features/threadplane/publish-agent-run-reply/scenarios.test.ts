import { testScenarios } from '@specter-ts/core/testing'

import { sqliteScenario } from '../../../db/scenario-tests'
import publishAgentRunReply from './slice'

testScenarios([publishAgentRunReply], {
  runScenario: sqliteScenario,
})

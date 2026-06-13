import { testScenarios } from '@specter-ts/core/testing'

import { sqliteScenario } from '../../db/scenario-tests'
import { workspaceRegistrations } from './registry'

testScenarios(workspaceRegistrations, {
  runScenario: sqliteScenario,
})

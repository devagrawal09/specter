import { testScenarios } from '@specter-ts/core/testing'

import { sqliteScenario } from '../../db/scenario-tests'
import { todoSqlRegistrations } from './registry'

testScenarios(todoSqlRegistrations, {
  runScenario: sqliteScenario({}),
})

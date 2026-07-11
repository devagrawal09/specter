import { testSliceImplementations } from '@specter-ts/core/testing'

import { sqliteScenario } from '../../db/scenario-tests'
import { todoEventDefinitions } from './events'
import { todoRegistrations } from './registry'

testSliceImplementations(todoRegistrations, {
  events: todoEventDefinitions,
  runScenario: sqliteScenario({}),
})

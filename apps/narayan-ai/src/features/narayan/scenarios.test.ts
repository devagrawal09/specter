import { testSliceImplementations } from '@specter-ts/core/testing'

import { sqliteScenario } from '../../db/scenario-tests'
import { narayanEventDefinitions } from './events'
import { narayanRegistrations } from './registry'

testSliceImplementations(narayanRegistrations, {
  events: narayanEventDefinitions,
  runScenario: sqliteScenario({}),
})

import { testScenarios } from '@specter-ts/core/testing'

import { sqliteScenario } from '../../db/scenario-tests'
import { bookingRegistrations } from './registry'

testScenarios(bookingRegistrations, {
  runScenario: sqliteScenario({}),
})

import { testSliceImplementations } from '@specter-ts/core/testing'

import { sqliteScenario } from '../../db/scenario-tests'
import { bookingEventDefinitions } from './events'
import { bookingRegistrations } from './registry'

testSliceImplementations(bookingRegistrations, {
  events: bookingEventDefinitions,
  runScenario: sqliteScenario({}),
})

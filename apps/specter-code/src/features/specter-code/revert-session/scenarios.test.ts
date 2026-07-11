import { testSliceImplementations } from '@specter-ts/core/testing'

import { sqliteScenario } from '../../../db/scenario-tests'
import { eventsForSliceImplementations } from '../../../testing/scenario-events'
import { specterCodeEventDefinitions } from '../registry'
import revertSession from './impl'

const registrations = [revertSession] as const
const events = eventsForSliceImplementations(
  registrations,
  specterCodeEventDefinitions,
)

testSliceImplementations(registrations, {
  events,
  runScenario: sqliteScenario,
})

import { testSliceImplementations } from '@specter-ts/core/testing'

import { sqliteScenario } from '../../../db/scenario-tests'
import { eventsForSliceImplementations } from '../../../testing/scenario-events'
import { specterCodeEventDefinitions } from '../registry'
import publishAgentRunReply from './impl'

const registrations = [publishAgentRunReply] as const
const events = eventsForSliceImplementations(
  registrations,
  specterCodeEventDefinitions,
)

testSliceImplementations(registrations, {
  events,
  runScenario: sqliteScenario,
})

import { testSliceImplementations } from '@specter-ts/core/testing'

import { sqliteScenario } from '../../db/scenario-tests'
import { eventsForSliceImplementations } from '../../testing/scenario-events'
import { specterCodeEventDefinitions } from './registry'
import ptySessions from './pty-sessions/impl'

const ptyRegistrations = [ptySessions] as const
const events = eventsForSliceImplementations(
  ptyRegistrations,
  specterCodeEventDefinitions,
)

testSliceImplementations(ptyRegistrations, {
  events,
  runScenario: sqliteScenario,
})

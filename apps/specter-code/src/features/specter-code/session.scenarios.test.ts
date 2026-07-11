import { testSliceImplementations } from '@specter-ts/core/testing'

import { sqliteScenario } from '../../db/scenario-tests'
import { eventsForSliceImplementations } from '../../testing/scenario-events'
import { specterCodeEventDefinitions } from './registry'
import createSession from './create-session/impl'
import deleteSession from './delete-session/impl'
import forkSession from './fork-session/impl'
import sessionChildren from './session-children/impl'
import sessionDetail from './session-detail/impl'
import sessionList from './session-list/impl'
import updateSession from './update-session/impl'

const sessionRegistrations = [
  createSession,
  updateSession,
  deleteSession,
  forkSession,
  sessionList,
  sessionDetail,
  sessionChildren,
] as const
const events = eventsForSliceImplementations(
  sessionRegistrations,
  specterCodeEventDefinitions,
)

testSliceImplementations(sessionRegistrations, {
  events,
  runScenario: sqliteScenario,
})

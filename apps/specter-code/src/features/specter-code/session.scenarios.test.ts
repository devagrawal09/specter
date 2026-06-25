import { testScenarios } from '@specter-ts/core/testing'

import { sqliteScenario } from '../../db/scenario-tests'
import createSession from './create-session/slice'
import deleteSession from './delete-session/slice'
import sessionDetail from './session-detail/slice'
import sessionList from './session-list/slice'
import updateSession from './update-session/slice'

const sessionRegistrations = [
  createSession,
  updateSession,
  deleteSession,
  sessionList,
  sessionDetail,
] as const

testScenarios(sessionRegistrations, {
  runScenario: sqliteScenario,
})

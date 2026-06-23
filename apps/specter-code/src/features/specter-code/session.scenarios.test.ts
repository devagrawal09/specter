import { testScenarios } from '@specter-ts/core/testing'

import { sqliteScenario } from '../../db/scenario-tests'
import createSession from './create-session/slice'
import sessionList from './session-list/slice'

const sessionRegistrations = [createSession, sessionList] as const

testScenarios(sessionRegistrations, {
  runScenario: sqliteScenario,
})

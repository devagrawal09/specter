import { testScenarios } from '@specter-ts/core/testing'

import { sqliteScenario } from '../../db/scenario-tests'
import ptySessions from './pty-sessions/slice'

const ptyRegistrations = [ptySessions] as const

testScenarios(ptyRegistrations, {
  runScenario: sqliteScenario,
})

import { testScenarios } from '@specter-ts/core/testing'

import { sqliteScenario } from '../../db/scenario-tests'
import sessionTranscript from './session-transcript/slice'
import submitPrompt from './submit-prompt/slice'

const promptTranscriptRegistrations = [submitPrompt, sessionTranscript] as const

testScenarios(promptTranscriptRegistrations, {
  runScenario: sqliteScenario,
})

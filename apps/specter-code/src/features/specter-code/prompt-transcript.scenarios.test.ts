import { testScenarios } from '@specter-ts/core/testing'

import { sqliteScenario } from '../../db/scenario-tests'
import recordSessionMessage from './record-session-message/slice'
import sessionTranscript from './session-transcript/slice'
import submitPrompt from './submit-prompt/slice'

const promptTranscriptRegistrations = [
  submitPrompt,
  recordSessionMessage,
  sessionTranscript,
] as const

testScenarios(promptTranscriptRegistrations, {
  runScenario: sqliteScenario,
})

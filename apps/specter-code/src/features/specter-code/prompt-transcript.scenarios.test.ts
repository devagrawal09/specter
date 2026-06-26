import { testScenarios } from '@specter-ts/core/testing'

import { sqliteScenario } from '../../db/scenario-tests'
import recordSessionMessage from './record-session-message/slice'
import deleteSessionMessage from './delete-session-message/slice'
import deleteSessionMessagePart from './delete-session-message-part/slice'
import sessionTranscript from './session-transcript/slice'
import submitPrompt from './submit-prompt/slice'
import updateSessionMessagePart from './update-session-message-part/slice'

const promptTranscriptRegistrations = [
  submitPrompt,
  recordSessionMessage,
  updateSessionMessagePart,
  deleteSessionMessagePart,
  deleteSessionMessage,
  sessionTranscript,
] as const

testScenarios(promptTranscriptRegistrations, {
  runScenario: sqliteScenario,
})

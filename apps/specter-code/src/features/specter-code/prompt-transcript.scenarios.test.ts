import { testSliceImplementations } from '@specter-ts/core/testing'

import { sqliteScenario } from '../../db/scenario-tests'
import { eventsForSliceImplementations } from '../../testing/scenario-events'
import { specterCodeEventDefinitions } from './registry'
import recordSessionMessage from './record-session-message/impl'
import deleteSessionMessage from './delete-session-message/impl'
import deleteSessionMessagePart from './delete-session-message-part/impl'
import sessionTranscript from './session-transcript/impl'
import submitPrompt from './submit-prompt/impl'
import updateSessionMessagePart from './update-session-message-part/impl'

const promptTranscriptRegistrations = [
  submitPrompt,
  recordSessionMessage,
  updateSessionMessagePart,
  deleteSessionMessagePart,
  deleteSessionMessage,
  sessionTranscript,
] as const
const events = eventsForSliceImplementations(
  promptTranscriptRegistrations,
  specterCodeEventDefinitions,
)

testSliceImplementations(promptTranscriptRegistrations, {
  events,
  runScenario: sqliteScenario,
})

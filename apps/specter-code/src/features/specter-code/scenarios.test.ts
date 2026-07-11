import { testSliceImplementations } from '@specter-ts/core/testing'

import { sqliteScenario } from '../../db/scenario-tests'
import { eventsForSliceImplementations } from '../../testing/scenario-events'
import { specterCodeEventDefinitions } from './registry'
import agentRunTimeline from './agent-run-timeline/impl'
import createSession from './create-session/impl'
import recordAgentRunCompleted from './record-agent-run-completed/impl'
import recordAgentRunFailed from './record-agent-run-failed/impl'
import recordAgentRunStarted from './record-agent-run-started/impl'
import recordAgentRunStreamed from './record-agent-run-streamed/impl'
import recordToolCallCompleted from './record-tool-call-completed/impl'
import recordToolCallFailed from './record-tool-call-failed/impl'
import recordToolCallStarted from './record-tool-call-started/impl'
import requestAgentRun from './request-agent-run/impl'
import sessionTranscript from './session-transcript/impl'
import sessionList from './session-list/impl'
import submitPrompt from './submit-prompt/impl'
import workspaceAgentRuns from './workspace-agent-runs/impl'

const specterCodeAgentRunRegistrations = [
  createSession,
  sessionList,
  submitPrompt,
  sessionTranscript,
  requestAgentRun,
  recordAgentRunStarted,
  recordAgentRunStreamed,
  recordAgentRunCompleted,
  recordAgentRunFailed,
  recordToolCallStarted,
  recordToolCallCompleted,
  recordToolCallFailed,
  workspaceAgentRuns,
  agentRunTimeline,
] as const
const events = eventsForSliceImplementations(
  specterCodeAgentRunRegistrations,
  specterCodeEventDefinitions,
)

testSliceImplementations(specterCodeAgentRunRegistrations, {
  events,
  runScenario: sqliteScenario,
})

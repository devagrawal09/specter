import { testScenarios } from '@specter-ts/core/testing'

import { sqliteScenario } from '../../db/scenario-tests'
import agentRunTimeline from './agent-run-timeline/slice'
import recordAgentRunCompleted from './record-agent-run-completed/slice'
import recordAgentRunFailed from './record-agent-run-failed/slice'
import recordAgentRunStarted from './record-agent-run-started/slice'
import recordAgentRunStreamed from './record-agent-run-streamed/slice'
import recordToolCallCompleted from './record-tool-call-completed/slice'
import recordToolCallFailed from './record-tool-call-failed/slice'
import recordToolCallStarted from './record-tool-call-started/slice'
import requestAgentRun from './request-agent-run/slice'
import workspaceAgentRuns from './workspace-agent-runs/slice'

const threadplaneAgentRunRegistrations = [
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

testScenarios(threadplaneAgentRunRegistrations, {
  runScenario: sqliteScenario,
})

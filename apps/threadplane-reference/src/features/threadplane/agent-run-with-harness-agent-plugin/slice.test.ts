import { createSpecterApp } from '@specter-ts/core'
import { expect, test } from 'vitest'

import { memoryEventLog, resetMemoryEventLogs } from '../../../testing/memory-event-log'
import { memoryReactionScheduler } from '../../../testing/memory-reaction-scheduler'
import { resetMemorySliceStores } from '../../../testing/memory-slice-store'
import agentRunWithHarnessAgentPlugin from './slice'
import { threadplaneEventDefinitions } from '../events'
import recordAgentRunCompleted from '../record-agent-run-completed/slice'
import recordAgentRunFailed from '../record-agent-run-failed/slice'
import recordAgentRunStarted from '../record-agent-run-started/slice'
import recordAgentRunStreamed from '../record-agent-run-streamed/slice'
import recordToolCallCompleted from '../record-tool-call-completed/slice'
import recordToolCallFailed from '../record-tool-call-failed/slice'
import recordToolCallStarted from '../record-tool-call-started/slice'
import requestAgentRun from '../request-agent-run/slice'

const agentRunAppConfig = {
  events: threadplaneEventDefinitions,
  eventLog: memoryEventLog,
  scheduler: memoryReactionScheduler,
  slices: [
    requestAgentRun,
    recordAgentRunStarted,
    recordAgentRunStreamed,
    recordAgentRunCompleted,
    recordAgentRunFailed,
    recordToolCallStarted,
    recordToolCallCompleted,
    recordToolCallFailed,
    agentRunWithHarnessAgentPlugin,
  ],
} as const

test('requested Agent Run persists HarnessAgent lifecycle events', async () => {
  resetMemoryEventLogs()
  resetMemorySliceStores()

  const app = createSpecterApp(agentRunAppConfig)

  await app.requestAgentRun({
    workspaceId: 'workspace-1',
    postId: 'post-1',
    agentId: 'specter',
    agentName: 'Specter',
    requestedBy: { type: 'user', userId: 'user-1', displayName: 'Ada' },
  })

  const events = await memoryEventLog.query(0, [
    'agentRunRequested',
    'agentRunStarted',
    'agentRunStreamed',
    'agentRunCompleted',
    'agentRunFailed',
  ])

  expect(events.map((event) => event.type)).toEqual([
    'agentRunRequested',
    'agentRunStarted',
    'agentRunStreamed',
    'agentRunCompleted',
  ])
  expect(events[0]?.payload).toMatchObject({
    workspaceId: 'workspace-1',
    postId: 'post-1',
    agentId: 'specter',
    agentName: 'Specter',
  })
})

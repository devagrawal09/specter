import { createReactionSlice } from '@specter-ts/core'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import {
  agentRunCompletedEvent,
  agentRunFailedEvent,
  agentRunRequestedEvent,
  agentRunStartedEvent,
} from '../events'

type AgentRunJob = {
  runId: string
  workspaceId: string
  postId?: string
  agentId: string
  agentName: string
}

type RunRequestedAgentRunState = {
  requestedRuns: AgentRunJob[]
  startedRunIds: Set<string>
  terminalRunIds: Set<string>
}

const runRequestedAgentRun = createReactionSlice(
  'runRequestedAgentRun',
  'Executes requested Agent Runs through the configured agent plugin.',
)
  .payload<AgentRunJob>()
  .plugin(async () => async () => {
    throw new Error('TODO: wire simulated or real agent plugin')
  })
  .store(
    createMemorySliceStore<RunRequestedAgentRunState>(() => ({
      requestedRuns: [],
      startedRunIds: new Set(),
      terminalRunIds: new Set(),
    })),
  )
  .scenarios(
    {
      description: 'Queues a requested Agent Run that has not started.',
      given: [
        agentRunRequestedEvent.create({
          runId: 'run-1',
          workspaceId: 'workspace-1',
          postId: 'post-1',
          agentId: 'specter',
          agentName: 'Specter',
          requestedBy: { type: 'user', displayName: 'Ada' },
        }),
      ],
      expect: [
        {
          runId: 'run-1',
          workspaceId: 'workspace-1',
          postId: 'post-1',
          agentId: 'specter',
          agentName: 'Specter',
        },
      ],
    },
    {
      description: 'Does not queue an Agent Run that already started.',
      given: [
        agentRunRequestedEvent.create({
          runId: 'run-1',
          workspaceId: 'workspace-1',
          agentId: 'specter',
          agentName: 'Specter',
          requestedBy: { type: 'system' },
        }),
        agentRunStartedEvent.create({
          runId: 'run-1',
          workspaceId: 'workspace-1',
          agentId: 'specter',
        }),
      ],
      expect: [],
    },
    {
      description:
        'Does not queue an Agent Run that already reached a terminal state.',
      given: [
        agentRunRequestedEvent.create({
          runId: 'run-1',
          workspaceId: 'workspace-1',
          agentId: 'specter',
          agentName: 'Specter',
          requestedBy: { type: 'system' },
        }),
        agentRunFailedEvent.create({
          runId: 'run-1',
          workspaceId: 'workspace-1',
          agentId: 'specter',
          error: 'Agent runtime unavailable',
        }),
        agentRunRequestedEvent.create({
          runId: 'run-2',
          workspaceId: 'workspace-1',
          agentId: 'specter',
          agentName: 'Specter',
          requestedBy: { type: 'system' },
        }),
        agentRunCompletedEvent.create({
          runId: 'run-2',
          workspaceId: 'workspace-1',
          agentId: 'specter',
        }),
      ],
      expect: [],
    },
  )
  .handle(async (): Promise<AgentRunJob | undefined> => {
    throw new Error('TODO: implement runRequestedAgentRun')
  })

export default runRequestedAgentRun

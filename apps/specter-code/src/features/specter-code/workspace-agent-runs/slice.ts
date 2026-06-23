import { createQuerySlice } from '@specter-ts/core'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import {
  agentRunCompletedEvent,
  agentRunFailedEvent,
  agentRunRequestedEvent,
  agentRunStartedEvent,
} from '../events'

type WorkspaceAgentRun = {
  runId: string
  workspaceId: string
  postId?: string
  agentId: string
  agentName: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  requestedBy:
    | { type: 'user'; userId?: string; displayName: string }
    | { type: 'agent'; agentId: string; displayName: string }
    | { type: 'system' }
  error?: string
}

type WorkspaceAgentRunsState = {
  runs: WorkspaceAgentRun[]
}

const workspaceAgentRuns = createQuerySlice(
  'workspaceAgentRuns',
  'Lists Agent Runs for a workspace with their latest status.',
)
  .schema(
    z.object({
      workspaceId: z.string(),
    }),
  )
  .store(createMemorySliceStore<WorkspaceAgentRunsState>(() => ({ runs: [] })))
  .apply({
    [agentRunRequestedEvent.type]: async (event, state) => {
      const payload = await agentRunRequestedEvent.decode(event.payload)
      if (payload.workspaceId) {
        state.runs.push({
          runId: payload.runId,
          workspaceId: payload.workspaceId,
          postId: payload.postId,
          agentId: payload.agentId,
          agentName: payload.agentName,
          status: 'pending',
          requestedBy: payload.requestedBy,
        })
      }
    },
    [agentRunStartedEvent.type]: async (event, state) => {
      const payload = await agentRunStartedEvent.decode(event.payload)
      const run = state.runs.find((item) => item.runId === payload.runId)
      if (run && run.workspaceId === payload.workspaceId) run.status = 'running'
    },
    [agentRunCompletedEvent.type]: async (event, state) => {
      const payload = await agentRunCompletedEvent.decode(event.payload)
      const run = state.runs.find((item) => item.runId === payload.runId)
      if (run && run.workspaceId === payload.workspaceId)
        run.status = 'completed'
    },
    [agentRunFailedEvent.type]: async (event, state) => {
      const payload = await agentRunFailedEvent.decode(event.payload)
      const run = state.runs.find((item) => item.runId === payload.runId)
      if (run && run.workspaceId === payload.workspaceId) {
        run.status = 'failed'
        run.error = payload.error
      }
    },
  })
  .scenarios({
    description:
      'Lists workspace Agent Runs with pending, running, completed, and failed statuses.',
    given: [
      agentRunRequestedEvent.create({
        runId: 'run-1',
        workspaceId: 'workspace-1',
        postId: 'post-1',
        agentId: 'specter',
        agentName: 'Specter',
        requestedBy: { type: 'user', userId: 'user-1', displayName: 'Ada' },
      }),
      agentRunStartedEvent.create({
        runId: 'run-1',
        workspaceId: 'workspace-1',
        agentId: 'specter',
      }),
      agentRunCompletedEvent.create({
        runId: 'run-1',
        workspaceId: 'workspace-1',
        agentId: 'specter',
      }),
      agentRunRequestedEvent.create({
        runId: 'run-2',
        workspaceId: 'workspace-1',
        agentId: 'specter',
        agentName: 'Specter',
        requestedBy: { type: 'system' },
      }),
      agentRunRequestedEvent.create({
        runId: 'run-3',
        workspaceId: 'workspace-1',
        agentId: 'specter',
        agentName: 'Specter',
        requestedBy: { type: 'system' },
      }),
      agentRunStartedEvent.create({
        runId: 'run-3',
        workspaceId: 'workspace-1',
        agentId: 'specter',
      }),
      agentRunRequestedEvent.create({
        runId: 'run-4',
        workspaceId: 'workspace-1',
        agentId: 'specter',
        agentName: 'Specter',
        requestedBy: { type: 'system' },
      }),
      agentRunFailedEvent.create({
        runId: 'run-4',
        workspaceId: 'workspace-1',
        agentId: 'specter',
        error: 'Agent runtime unavailable',
      }),
      agentRunRequestedEvent.create({
        runId: 'run-5',
        workspaceId: 'workspace-2',
        agentId: 'specter',
        agentName: 'Specter',
        requestedBy: { type: 'system' },
      }),
    ],
    when: { workspaceId: 'workspace-1' },
    expect: [
      {
        runId: 'run-1',
        workspaceId: 'workspace-1',
        postId: 'post-1',
        agentId: 'specter',
        agentName: 'Specter',
        status: 'completed',
        requestedBy: { type: 'user', userId: 'user-1', displayName: 'Ada' },
      },
      {
        runId: 'run-2',
        workspaceId: 'workspace-1',
        agentId: 'specter',
        agentName: 'Specter',
        status: 'pending',
        requestedBy: { type: 'system' },
      },
      {
        runId: 'run-3',
        workspaceId: 'workspace-1',
        agentId: 'specter',
        agentName: 'Specter',
        status: 'running',
        requestedBy: { type: 'system' },
      },
      {
        runId: 'run-4',
        workspaceId: 'workspace-1',
        agentId: 'specter',
        agentName: 'Specter',
        status: 'failed',
        requestedBy: { type: 'system' },
        error: 'Agent runtime unavailable',
      },
    ],
  })
  .handle(async (query, state): Promise<WorkspaceAgentRun[]> => {
    return state.runs.filter((run) => run.workspaceId === query.workspaceId)
  })

export default workspaceAgentRuns

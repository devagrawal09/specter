import workspaceAgentRunsSpec from './spec'
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

const workspaceAgentRuns = workspaceAgentRunsSpec
  .inputSchema(z.object({
      workspaceId: z.string(),
    }))
  .outputSchema<WorkspaceAgentRun[]>()
  .store(createMemorySliceStore<WorkspaceAgentRunsState>(() => ({ runs: [] })))
  .apply(agentRunRequestedEvent, async (event, state) => {
      const payload = event.payload
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
    })
  .apply(agentRunStartedEvent, async (event, state) => {
      const payload = event.payload
      const run = state.runs.find((item) => item.runId === payload.runId)
      if (run && run.workspaceId === payload.workspaceId) run.status = 'running'
    })
  .apply(agentRunCompletedEvent, async (event, state) => {
      const payload = event.payload
      const run = state.runs.find((item) => item.runId === payload.runId)
      if (run && run.workspaceId === payload.workspaceId)
        run.status = 'completed'
    })
  .apply(agentRunFailedEvent, async (event, state) => {
      const payload = event.payload
      const run = state.runs.find((item) => item.runId === payload.runId)
      if (run && run.workspaceId === payload.workspaceId) {
        run.status = 'failed'
        run.error = payload.error
      }
    })
  .handle(async (query, state): Promise<WorkspaceAgentRun[]> => {
    return state.runs.filter((run) => run.workspaceId === query.workspaceId)
  })

export default workspaceAgentRuns

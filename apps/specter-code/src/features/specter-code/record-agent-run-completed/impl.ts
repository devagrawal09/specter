import recordAgentRunCompletedSpec from './spec'
import { z } from 'zod'

import { defineMemorySliceStore } from '../../../testing/memory-slice-store'
import { agentRunCompletedEvent } from '../events'

const recordAgentRunCompleted = recordAgentRunCompletedSpec
  .inputSchema(
    z.object({
      runId: z.string(),
      workspaceId: z.string(),
      agentId: z.string(),
    }),
  )
  .store(defineMemorySliceStore(() => ({})))
  .handle(async (command) => {
    return [
      agentRunCompletedEvent.create({
        runId: command.runId,
        workspaceId: command.workspaceId,
        agentId: command.agentId,
      }),
    ]
  })

export default recordAgentRunCompleted

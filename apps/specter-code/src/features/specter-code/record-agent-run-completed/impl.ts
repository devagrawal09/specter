import specification from './spec.json' with { type: 'json' }
import { implementCommand } from '@specter-ts/core'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import { agentRunCompletedEvent } from '../events'

const recordAgentRunCompleted = implementCommand<'recordAgentRunCompleted'>(
  specification,
)
  .inputSchema(
    z.object({
      runId: z.string(),
      workspaceId: z.string(),
      agentId: z.string(),
    }),
  )
  .store(createMemorySliceStore(() => ({})))
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

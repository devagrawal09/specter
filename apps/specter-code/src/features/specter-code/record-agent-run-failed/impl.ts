import specification from './spec.json' with { type: 'json' }
import { implementCommand } from '@specter-ts/core'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import { agentRunFailedEvent } from '../events'

const recordAgentRunFailed = implementCommand<'recordAgentRunFailed'>(
  specification,
)
  .inputSchema(
    z.object({
      runId: z.string(),
      workspaceId: z.string(),
      agentId: z.string(),
      error: z.string(),
    }),
  )
  .store(createMemorySliceStore(() => ({})))
  .handle(async (command) => {
    const error = command.error.trim()

    if (!error) {
      throw new Error('Agent run error is required')
    }

    return [
      agentRunFailedEvent.create({
        runId: command.runId,
        workspaceId: command.workspaceId,
        agentId: command.agentId,
        error,
      }),
    ]
  })

export default recordAgentRunFailed

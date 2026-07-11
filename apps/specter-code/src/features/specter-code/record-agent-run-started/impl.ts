import recordAgentRunStartedSpec from './spec'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import { agentRunStartedEvent } from '../events'

const recordAgentRunStarted = recordAgentRunStartedSpec
  .inputSchema(z.object({
      runId: z.string(),
      workspaceId: z.string(),
      agentId: z.string(),
    }))
  .store(createMemorySliceStore(() => ({})))
  .handle(async (command) => {
    return [
      agentRunStartedEvent.create({
        runId: command.runId,
        workspaceId: command.workspaceId,
        agentId: command.agentId,
      }),
    ]
  })

export default recordAgentRunStarted

import { createCommandSlice } from '@specter-ts/core'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import { agentRunCompletedEvent } from '../events'

const recordAgentRunCompleted = createCommandSlice(
  'recordAgentRunCompleted',
  'Persists that an Agent Run completed.',
)
  .schema(
    z.object({
      runId: z.string(),
      workspaceId: z.string(),
      agentId: z.string(),
    }),
  )
  .store(createMemorySliceStore(() => ({})))
  .handle(async (command) => [agentRunCompletedEvent.create(command)])

export default recordAgentRunCompleted

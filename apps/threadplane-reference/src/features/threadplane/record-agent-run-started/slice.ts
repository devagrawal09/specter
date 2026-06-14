import { createCommandSlice } from '@specter-ts/core'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import { agentRunStartedEvent } from '../events'

const recordAgentRunStarted = createCommandSlice(
  'recordAgentRunStarted',
  'Persists that an Agent Run started.',
)
  .schema(
    z.object({
      runId: z.string(),
      workspaceId: z.string(),
      agentId: z.string(),
    }),
  )
  .store(createMemorySliceStore(() => ({})))
  .handle(async (command) => [agentRunStartedEvent.create(command)])

export default recordAgentRunStarted

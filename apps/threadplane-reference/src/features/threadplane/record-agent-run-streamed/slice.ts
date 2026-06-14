import { createCommandSlice } from '@specter-ts/core'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import { agentRunStreamedEvent } from '../events'

const recordAgentRunStreamed = createCommandSlice(
  'recordAgentRunStreamed',
  'Persists streamed Agent Run output.',
)
  .schema(
    z.object({
      runId: z.string(),
      workspaceId: z.string(),
      agentId: z.string(),
      chunkId: z.string(),
      delta: z.string(),
    }),
  )
  .store(createMemorySliceStore(() => ({})))
  .handle(async (command) => [agentRunStreamedEvent.create(command)])

export default recordAgentRunStreamed

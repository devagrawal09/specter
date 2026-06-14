import { createCommandSlice } from '@specter-ts/core'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import { agentRunFailedEvent } from '../events'

const recordAgentRunFailed = createCommandSlice(
  'recordAgentRunFailed',
  'Persists that an Agent Run failed.',
)
  .schema(
    z.object({
      runId: z.string(),
      workspaceId: z.string(),
      agentId: z.string(),
      error: z.string(),
    }),
  )
  .store(createMemorySliceStore(() => ({})))
  .handle(async (command) => [agentRunFailedEvent.create(command)])

export default recordAgentRunFailed

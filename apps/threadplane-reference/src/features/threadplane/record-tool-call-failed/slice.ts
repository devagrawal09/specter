import { createCommandSlice } from '@specter-ts/core'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import { toolCallFailedEvent } from '../events'

const recordToolCallFailed = createCommandSlice(
  'recordToolCallFailed',
  'Persists that an Agent Run tool call failed.',
)
  .schema(
    z.object({
      toolCallId: z.string(),
      runId: z.string(),
      workspaceId: z.string(),
      agentId: z.string(),
      toolName: z.string(),
      error: z.string(),
    }),
  )
  .store(createMemorySliceStore(() => ({})))
  .handle(async (command) => [toolCallFailedEvent.create(command)])

export default recordToolCallFailed

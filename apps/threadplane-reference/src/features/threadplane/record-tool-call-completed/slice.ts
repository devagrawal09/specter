import { createCommandSlice } from '@specter-ts/core'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import { toolCallCompletedEvent } from '../events'

const recordToolCallCompleted = createCommandSlice(
  'recordToolCallCompleted',
  'Persists that an Agent Run tool call completed.',
)
  .schema(
    z.object({
      toolCallId: z.string(),
      runId: z.string(),
      workspaceId: z.string(),
      agentId: z.string(),
      toolName: z.string(),
      output: z.unknown(),
    }),
  )
  .store(createMemorySliceStore(() => ({})))
  .handle(async (command) => [toolCallCompletedEvent.create(command)])

export default recordToolCallCompleted

import { createCommandSlice } from '@specter-ts/core'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import { toolCallStartedEvent } from '../events'

const recordToolCallStarted = createCommandSlice(
  'recordToolCallStarted',
  'Persists that an Agent Run tool call started.',
)
  .schema(
    z.object({
      toolCallId: z.string(),
      runId: z.string(),
      workspaceId: z.string(),
      agentId: z.string(),
      toolName: z.string(),
      input: z.unknown(),
    }),
  )
  .store(createMemorySliceStore(() => ({})))
  .handle(async (command) => [toolCallStartedEvent.create(command)])

export default recordToolCallStarted

import { createCommandSlice } from '@specter-ts/core'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'

const triggerAgent = createCommandSlice(
  'triggerAgent',
  'Triggers an agent for a workspace post.',
)
  .schema(
    z.object({
      workspaceId: z.string(),
      postId: z.string(),
      agentId: z.string(),
      agentName: z.string(),
    }),
  )
  .store(createMemorySliceStore(() => ({})))

export default triggerAgent

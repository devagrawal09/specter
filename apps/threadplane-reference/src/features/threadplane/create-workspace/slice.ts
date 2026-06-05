import { createCommandSlice } from '@specter-ts/core'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'

const createWorkspace = createCommandSlice(
  'createWorkspace',
  'Creates a workspace for posts, agents, and workspace files.',
)
  .schema(
    z.object({
      name: z.string(),
      createdBy: z
        .object({
          userId: z.string().optional(),
          displayName: z.string(),
        })
        .optional(),
    }),
  )
  .store(createMemorySliceStore(() => ({})))

export default createWorkspace

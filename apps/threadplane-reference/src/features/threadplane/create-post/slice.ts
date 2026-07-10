import { createCommandSlice } from '@specter-ts/core'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'

const createPost = createCommandSlice(
  'createPost',
  'Creates a top-level post in a workspace chat.',
)
  .schema(
    z.object({
      workspaceId: z.string(),
      authorName: z.string(),
      content: z.string(),
    }),
  )
  .store(createMemorySliceStore(() => ({})))

export default createPost

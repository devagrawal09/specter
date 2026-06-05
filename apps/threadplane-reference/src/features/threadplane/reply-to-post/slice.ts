import { createCommandSlice } from '@specter-ts/core'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'

const replyToPost = createCommandSlice(
  'replyToPost',
  'Replies to an existing post in a workspace chat.',
)
  .schema(
    z.object({
      workspaceId: z.string(),
      parentPostId: z.string(),
      authorName: z.string(),
      content: z.string(),
    }),
  )
  .store(createMemorySliceStore(() => ({})))

export default replyToPost

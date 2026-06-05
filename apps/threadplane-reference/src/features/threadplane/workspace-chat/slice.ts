import { createQuerySlice } from '@specter-ts/core'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'

type WorkspaceChatState = {
  posts: {
    id: string
    workspaceId: string
    parentPostId?: string
    author: {
      type: 'user' | 'agent'
      displayName: string
      agentId?: string
    }
    content: string
  }[]
}

const workspaceChat = createQuerySlice(
  'workspaceChat',
  'Shows posts and replies in a workspace chat.',
)
  .schema(
    z.object({
      workspaceId: z.string(),
    }),
  )
  .store(createMemorySliceStore<WorkspaceChatState>(() => ({ posts: [] })))

export default workspaceChat

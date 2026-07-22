import specification from './spec.json' with { type: 'json' }
import { implementQuery } from '@specter-ts/core'
import { z } from 'zod'

import { defineMemorySliceStore } from '../../../testing/memory-slice-store'
import { postCreatedEvent, postReplyCreatedEvent } from '../events'

type WorkspaceChatItem = {
  id: string
  workspaceId: string
  parentPostId?: string
  author:
    | {
        type: 'user'
        userId?: string
        displayName: string
      }
    | {
        type: 'agent'
        agentId: string
        displayName: string
      }
  content: string
  sourceRunId?: string
}

type WorkspaceChatState = {
  posts: WorkspaceChatItem[]
}

const workspaceChat = implementQuery(specification)
  .inputSchema(
    z.object({
      workspaceId: z.string(),
    }),
  )
  .outputSchema<WorkspaceChatItem[]>()
  .store(defineMemorySliceStore<WorkspaceChatState>(() => ({ posts: [] })))
  .apply(postCreatedEvent, async (event, state) => {
    const payload = event.payload

    state.posts.push({
      id: payload.postId,
      workspaceId: payload.workspaceId,
      author: payload.author,
      content: payload.content,
      sourceRunId: payload.sourceRunId,
    })
  })
  .apply(postReplyCreatedEvent, async (event, state) => {
    const payload = event.payload

    state.posts.push({
      id: payload.replyId,
      workspaceId: payload.workspaceId,
      parentPostId: payload.parentPostId,
      author: payload.author,
      content: payload.content,
      sourceRunId: payload.sourceRunId,
    })
  })
  .handle(async (query, state) =>
    state.posts.filter((post) => post.workspaceId === query.workspaceId),
  )

export default workspaceChat

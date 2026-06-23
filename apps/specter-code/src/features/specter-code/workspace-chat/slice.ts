import { createQuerySlice } from '@specter-ts/core'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
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
  .apply({
    [postCreatedEvent.type]: async (event, state) => {
      const payload = await postCreatedEvent.decode(event.payload)

      state.posts.push({
        id: payload.postId,
        workspaceId: payload.workspaceId,
        author: payload.author,
        content: payload.content,
        sourceRunId: payload.sourceRunId,
      })
    },
    [postReplyCreatedEvent.type]: async (event, state) => {
      const payload = await postReplyCreatedEvent.decode(event.payload)

      state.posts.push({
        id: payload.replyId,
        workspaceId: payload.workspaceId,
        parentPostId: payload.parentPostId,
        author: payload.author,
        content: payload.content,
        sourceRunId: payload.sourceRunId,
      })
    },
  })
  .scenarios({
    description:
      'Lists workspace posts, user replies, and visible agent replies in posting order.',
    given: [
      postCreatedEvent.create({
        postId: 'post-1',
        workspaceId: 'workspace-1',
        author: { type: 'user', userId: 'user-1', displayName: 'Ada' },
        content: 'Can Specter inspect this workspace?',
      }),
      postCreatedEvent.create({
        postId: 'post-2',
        workspaceId: 'workspace-2',
        author: { type: 'user', displayName: 'Grace' },
        content: 'Wrong workspace',
      }),
      postReplyCreatedEvent.create({
        replyId: 'reply-1',
        workspaceId: 'workspace-1',
        parentPostId: 'post-1',
        author: { type: 'user', displayName: 'Grace' },
        content: 'Please check src/index.ts.',
      }),
      postReplyCreatedEvent.create({
        replyId: 'reply-2',
        workspaceId: 'workspace-1',
        parentPostId: 'post-1',
        author: { type: 'agent', agentId: 'specter', displayName: 'Specter' },
        content: 'I found a failing test.',
        sourceRunId: 'run-1',
      }),
    ],
    when: { workspaceId: 'workspace-1' },
    expect: [
      {
        id: 'post-1',
        workspaceId: 'workspace-1',
        author: { type: 'user', userId: 'user-1', displayName: 'Ada' },
        content: 'Can Specter inspect this workspace?',
      },
      {
        id: 'reply-1',
        workspaceId: 'workspace-1',
        parentPostId: 'post-1',
        author: { type: 'user', displayName: 'Grace' },
        content: 'Please check src/index.ts.',
      },
      {
        id: 'reply-2',
        workspaceId: 'workspace-1',
        parentPostId: 'post-1',
        author: { type: 'agent', agentId: 'specter', displayName: 'Specter' },
        content: 'I found a failing test.',
        sourceRunId: 'run-1',
      },
    ],
  })
  .handle(async (query, state) =>
    state.posts.filter((post) => post.workspaceId === query.workspaceId),
  )

export default workspaceChat

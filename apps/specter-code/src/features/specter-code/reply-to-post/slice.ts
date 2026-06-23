import { createCommandSlice } from '@specter-ts/core'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import { postCreatedEvent, postReplyCreatedEvent } from '../events'

const replyToPost = createCommandSlice(
  'replyToPost',
  'Replies to an existing post in a workspace chat.',
)
  .schema(
    z.object({
      workspaceId: z.string(),
      parentPostId: z.string(),
      author: z.object({
        userId: z.string().optional(),
        displayName: z.string(),
      }),
      content: z.string(),
    }),
  )
  .store(createMemorySliceStore(() => ({})))
  .scenarios(
    {
      description: 'Creates a trimmed user reply to an existing post.',
      given: [
        postCreatedEvent.create({
          postId: 'post-1',
          workspaceId: 'workspace-1',
          author: { type: 'user', displayName: 'Grace Hopper' },
          content: 'Can Specter inspect this?',
        }),
      ],
      when: {
        workspaceId: 'workspace-1',
        parentPostId: 'post-1',
        author: { userId: 'user-1', displayName: 'Ada Lovelace' },
        content: '  Please check src/index.ts  ',
      },
      expect: [
        postReplyCreatedEvent.create({
          replyId: 'generated',
          workspaceId: 'workspace-1',
          parentPostId: 'post-1',
          author: {
            type: 'user',
            userId: 'user-1',
            displayName: 'Ada Lovelace',
          },
          content: 'Please check src/index.ts',
        }),
      ],
    },
    {
      description: 'Rejects a blank reply body.',
      given: [],
      when: {
        workspaceId: 'workspace-1',
        parentPostId: 'post-1',
        author: { displayName: 'Ada Lovelace' },
        content: '   ',
      },
      expect: [],
      reject: { reason: 'Reply content is required' },
    },
  )
  .handle(async (command) => {
    const content = command.content.trim()

    if (!content) {
      throw new Error('Reply content is required')
    }

    return [
      postReplyCreatedEvent.create({
        replyId: crypto.randomUUID(),
        workspaceId: command.workspaceId,
        parentPostId: command.parentPostId,
        author: {
          type: 'user',
          userId: command.author.userId,
          displayName: command.author.displayName,
        },
        content,
      }),
    ]
  })

export default replyToPost

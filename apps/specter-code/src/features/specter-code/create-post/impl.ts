import specification from './spec.json' with { type: 'json' }
import { implementCommand } from '@specter-ts/core'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import { postCreatedEvent } from '../events'

const createPost = implementCommand<'createPost'>(specification)
  .inputSchema(
    z.object({
      postId: z.string(),
      workspaceId: z.string(),
      author: z.object({
        userId: z.string().optional(),
        displayName: z.string(),
      }),
      content: z.string(),
    }),
  )
  .store(createMemorySliceStore(() => ({})))
  .handle(async (command) => {
    const content = command.content.trim()

    if (!content) {
      throw new Error('Post content is required')
    }

    return [
      postCreatedEvent.create({
        postId: command.postId,
        workspaceId: command.workspaceId,
        author: {
          type: 'user',
          userId: command.author.userId,
          displayName: command.author.displayName,
        },
        content,
      }),
    ]
  })

export default createPost

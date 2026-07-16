import replyToPostSpec from './spec'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import { postCreatedEvent, postReplyCreatedEvent } from '../events'

const replyToPost = replyToPostSpec
  .inputSchema(
    z.object({
      replyId: z.string(),
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
  .apply(postCreatedEvent, async () => {})
  .handle(async (command) => {
    const content = command.content.trim()

    if (!content) {
      throw new Error('Reply content is required')
    }

    return [
      postReplyCreatedEvent.create({
        replyId: command.replyId,
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

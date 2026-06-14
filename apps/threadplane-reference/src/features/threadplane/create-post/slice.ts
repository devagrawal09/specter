import { createCommandSlice } from '@specter-ts/core'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import { postCreatedEvent } from '../events'

const createPost = createCommandSlice(
  'createPost',
  'Creates a top-level post in a workspace chat.',
)
  .schema(
    z.object({
      workspaceId: z.string(),
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
      description: 'Creates a trimmed user post in a workspace.',
      given: [],
      when: {
        workspaceId: 'workspace-1',
        author: { userId: 'user-1', displayName: 'Ada Lovelace' },
        content: '  Can Specter inspect this workspace?  ',
      },
      expect: [
        postCreatedEvent.create({
          postId: 'generated',
          workspaceId: 'workspace-1',
          author: {
            type: 'user',
            userId: 'user-1',
            displayName: 'Ada Lovelace',
          },
          content: 'Can Specter inspect this workspace?',
        }),
      ],
    },
    {
      description: 'Rejects a blank post body.',
      given: [],
      when: {
        workspaceId: 'workspace-1',
        author: { displayName: 'Ada Lovelace' },
        content: '   ',
      },
      expect: [],
      reject: { reason: 'Post content is required' },
    },
  )
  .handle(async (command) => {
    const content = command.content.trim()

    if (!content) {
      throw new Error('Post content is required')
    }

    return [
      postCreatedEvent.create({
        postId: crypto.randomUUID(),
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

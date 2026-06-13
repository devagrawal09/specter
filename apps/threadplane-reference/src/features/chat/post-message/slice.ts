import { createCommandSlice } from '@specter-ts/core'
import { z } from 'zod'

import { createSqliteSliceStore } from '../../../db/specter-sqlite'
import { messagePostedEvent } from '../events'

const postMessage = createCommandSlice(
  'postMessage',
  'Posts a user message into a workspace chat.',
)
  .schema(
    z.object({
      workspaceId: z.string(),
      authorName: z.string(),
      content: z.string(),
      parentMessageId: z.string().optional(),
    }),
  )
  .store(createSqliteSliceStore(() => ({})))
  .scenarios({
    description: 'Posts a trimmed user message.',
    given: [],
    when: {
      workspaceId: 'workspace-1',
      authorName: 'Ada Lovelace',
      content: '  Hello Specter  ',
    },
    expect: [
      messagePostedEvent.create({
        messageId: 'generated',
        workspaceId: 'workspace-1',
        author: { type: 'user', displayName: 'Ada Lovelace' },
        content: 'Hello Specter',
      }),
    ],
  })
  .handle(async (command) => {
    const content = command.content.trim()

    if (!content) {
      throw new Error('Message content is required')
    }

    return [
      messagePostedEvent.create({
        messageId: crypto.randomUUID(),
        workspaceId: command.workspaceId,
        author: { type: 'user', displayName: command.authorName },
        content,
        parentMessageId: command.parentMessageId,
      }),
    ]
  })

export default postMessage

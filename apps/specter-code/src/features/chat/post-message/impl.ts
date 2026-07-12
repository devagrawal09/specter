import postMessageSpec from './spec'
import { z } from 'zod'

import { createSqliteSliceStore } from '../../../db/specter-sqlite'
import { messagePostedEvent } from '../events'

const postMessage = postMessageSpec
  .inputSchema(z.object({
      messageId: z.string(),
      workspaceId: z.string(),
      authorName: z.string(),
      content: z.string(),
      parentMessageId: z.string().optional(),
    }))
  .store(createSqliteSliceStore(() => ({})))
  .handle(async (command) => {
    const content = command.content.trim()

    if (!content) {
      throw new Error('Message content is required')
    }

    return [
      messagePostedEvent.create({
        messageId: command.messageId,
        workspaceId: command.workspaceId,
        author: { type: 'user', displayName: command.authorName },
        content,
        parentMessageId: command.parentMessageId,
      }),
    ]
  })

export default postMessage

import recordAgentReplySpec from './spec'
import { z } from 'zod'

import { createSqliteSliceStore } from '../../../db/specter-sqlite'
import { messagePostedEvent } from '../events'

const recordAgentReply = recordAgentReplySpec
  .inputSchema(z.object({
      messageId: z.string(),
      workspaceId: z.string(),
      replyToMessageId: z.string(),
      agentId: z.string(),
      agentName: z.string(),
      content: z.string(),
    }))
  .store(createSqliteSliceStore(() => ({})))
  .handle(async (command) => {
    const content = command.content.trim()

    if (!content) {
      throw new Error('Agent reply content is required')
    }

    return [
      messagePostedEvent.create({
        messageId: command.messageId,
        workspaceId: command.workspaceId,
        author: {
          type: 'agent',
          displayName: command.agentName,
          agentId: command.agentId,
        },
        content,
        parentMessageId: command.replyToMessageId,
      }),
    ]
  })

export default recordAgentReply

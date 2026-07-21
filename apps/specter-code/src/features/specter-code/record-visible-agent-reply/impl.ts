import recordVisibleAgentReplySpec from './spec'
import { z } from 'zod'

import { defineMemorySliceStore } from '../../../testing/memory-slice-store'
import { postReplyCreatedEvent } from '../events'

const recordVisibleAgentReply = recordVisibleAgentReplySpec
  .inputSchema(
    z.object({
      replyId: z.string(),
      workspaceId: z.string(),
      parentPostId: z.string(),
      runId: z.string(),
      agentId: z.string(),
      agentName: z.string(),
      content: z.string(),
    }),
  )
  .store(defineMemorySliceStore(() => ({})))
  .handle(async (command) => {
    const content = command.content.trim()

    if (!content) {
      throw new Error('Agent reply content is required')
    }

    return [
      postReplyCreatedEvent.create({
        replyId: command.replyId,
        workspaceId: command.workspaceId,
        parentPostId: command.parentPostId,
        author: {
          type: 'agent',
          agentId: command.agentId,
          displayName: command.agentName,
        },
        content,
        sourceRunId: command.runId,
      }),
    ]
  })

export default recordVisibleAgentReply

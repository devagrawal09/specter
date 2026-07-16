import recordSessionMessageSpec from './spec'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import { userMessageSubmittedEvent } from '../events'

const recordSessionMessage = recordSessionMessageSpec
  .inputSchema(
    z.object({
      messageId: z.string(),
      sessionId: z.string(),
      workspaceId: z.string(),
      content: z.string(),
      submittedBy: z.object({
        userId: z.string().optional(),
        displayName: z.string(),
      }),
    }),
  )
  .store(createMemorySliceStore(() => ({})))

  .handle(async (command) => {
    const content = command.content.trim()
    if (!content) throw new Error('Message content is required')

    return [
      userMessageSubmittedEvent.create({
        messageId: command.messageId,
        sessionId: command.sessionId,
        workspaceId: command.workspaceId,
        content,
        submittedBy: command.submittedBy,
      }),
    ]
  })

export default recordSessionMessage

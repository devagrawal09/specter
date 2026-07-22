import specification from './spec.json' with { type: 'json' }
import { implementCommand } from '@specter-ts/core'
import { z } from 'zod'

import { defineMemorySliceStore } from '../../../testing/memory-slice-store'
import { userMessageSubmittedEvent } from '../events'

const recordSessionMessage = implementCommand(specification)
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
  .store(defineMemorySliceStore(() => ({})))

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

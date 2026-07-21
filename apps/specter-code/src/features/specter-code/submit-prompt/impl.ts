import submitPromptSpec from './spec'
import { z } from 'zod'

import { defineMemorySliceStore } from '../../../testing/memory-slice-store'
import { agentRunRequestedEvent, userMessageSubmittedEvent } from '../events'

const submitPrompt = submitPromptSpec
  .inputSchema(
    z.object({
      messageId: z.string(),
      runId: z.string(),
      sessionId: z.string(),
      workspaceId: z.string(),
      content: z.string(),
      agentId: z.string(),
      agentName: z.string(),
      submittedBy: z.object({
        userId: z.string().optional(),
        displayName: z.string(),
      }),
    }),
  )
  .store(defineMemorySliceStore(() => ({})))

  .handle(async (command) => {
    const content = command.content.trim()

    if (!content) {
      throw new Error('Prompt content is required')
    }

    const messageId = command.messageId

    return [
      userMessageSubmittedEvent.create({
        messageId,
        sessionId: command.sessionId,
        workspaceId: command.workspaceId,
        content,
        submittedBy: command.submittedBy,
      }),
      agentRunRequestedEvent.create({
        runId: command.runId,
        workspaceId: command.workspaceId,
        postId: messageId,
        agentId: command.agentId,
        agentName: command.agentName,
        requestedBy: {
          type: 'user',
          userId: command.submittedBy.userId,
          displayName: command.submittedBy.displayName,
        },
      }),
    ]
  })

export default submitPrompt

import { createCommandSlice } from '@specter-ts/core'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import { agentRunRequestedEvent, userMessageSubmittedEvent } from '../events'

const submitPrompt = createCommandSlice(
  'submitPrompt',
  'Records a user prompt and requests a coding-agent turn.',
)
  .schema(
    z.object({
      messageId: z.string().optional(),
      runId: z.string().optional(),
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
  .store(createMemorySliceStore(() => ({})))
  .scenarios(
    {
      description: 'Records a prompt and requests an agent run for the session.',
      given: [],
      when: {
        messageId: 'message-1',
        runId: 'run-1',
        sessionId: 'session-1',
        workspaceId: 'workspace-1',
        content: '  add a test and run it  ',
        agentId: 'build',
        agentName: 'Build Agent',
        submittedBy: { userId: 'user-1', displayName: 'Ada Lovelace' },
      },
      expect: [
        userMessageSubmittedEvent.create({
          messageId: 'message-1',
          sessionId: 'session-1',
          workspaceId: 'workspace-1',
          content: 'add a test and run it',
          submittedBy: { userId: 'user-1', displayName: 'Ada Lovelace' },
        }),
        agentRunRequestedEvent.create({
          runId: 'run-1',
          workspaceId: 'workspace-1',
          postId: 'message-1',
          agentId: 'build',
          agentName: 'Build Agent',
          requestedBy: { type: 'user', userId: 'user-1', displayName: 'Ada Lovelace' },
        }),
      ],
    },
    {
      description: 'Rejects a blank prompt.',
      given: [],
      when: {
        sessionId: 'session-1',
        workspaceId: 'workspace-1',
        content: '   ',
        agentId: 'build',
        agentName: 'Build Agent',
        submittedBy: { displayName: 'Ada Lovelace' },
      },
      expect: [],
      reject: { reason: 'Prompt content is required' },
    },
  )
  .handle(async (command) => {
    const content = command.content.trim()

    if (!content) {
      throw new Error('Prompt content is required')
    }

    const messageId = command.messageId ?? crypto.randomUUID()

    return [
      userMessageSubmittedEvent.create({
        messageId,
        sessionId: command.sessionId,
        workspaceId: command.workspaceId,
        content,
        submittedBy: command.submittedBy,
      }),
      agentRunRequestedEvent.create({
        runId: command.runId ?? crypto.randomUUID(),
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

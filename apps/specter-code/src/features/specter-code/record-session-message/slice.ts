import { createCommandSlice } from '@specter-ts/core'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import { userMessageSubmittedEvent } from '../events'

const recordSessionMessage = createCommandSlice(
  'recordSessionMessage',
  'Records a user message in a session without requesting an agent turn.',
)
  .schema(
    z.object({
      messageId: z.string().optional(),
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
  .scenarios(
    {
      description: 'Records a no-reply session message without requesting an agent run.',
      given: [],
      when: {
        messageId: 'message-no-reply-1',
        sessionId: 'session-1',
        workspaceId: 'workspace-1',
        content: '  note this context only  ',
        submittedBy: { userId: 'user-1', displayName: 'Ada Lovelace' },
      },
      expect: [
        userMessageSubmittedEvent.create({
          messageId: 'message-no-reply-1',
          sessionId: 'session-1',
          workspaceId: 'workspace-1',
          content: 'note this context only',
          submittedBy: { userId: 'user-1', displayName: 'Ada Lovelace' },
        }),
      ],
    },
    {
      description: 'Rejects a blank no-reply message.',
      given: [],
      when: {
        sessionId: 'session-1',
        workspaceId: 'workspace-1',
        content: '   ',
        submittedBy: { displayName: 'Ada Lovelace' },
      },
      expect: [],
      reject: { reason: 'Message content is required' },
    },
  )
  .handle(async (command) => {
    const content = command.content.trim()
    if (!content) throw new Error('Message content is required')

    return [
      userMessageSubmittedEvent.create({
        messageId: command.messageId ?? crypto.randomUUID(),
        sessionId: command.sessionId,
        workspaceId: command.workspaceId,
        content,
        submittedBy: command.submittedBy,
      }),
    ]
  })

export default recordSessionMessage

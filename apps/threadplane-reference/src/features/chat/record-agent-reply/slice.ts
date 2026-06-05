import { createCommandSlice } from '@specter-ts/core'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import { messagePostedEvent } from '../events'

const recordAgentReply = createCommandSlice(
  'recordAgentReply',
  'Records a simulated agent reply in a workspace chat.',
)
  .schema(
    z.object({
      workspaceId: z.string(),
      replyToMessageId: z.string(),
      agentId: z.string(),
      agentName: z.string(),
      content: z.string(),
    }),
  )
  .store(createMemorySliceStore(() => ({})))
  .scenarios({
    description: 'Records an agent reply beneath the triggering message.',
    given: [],
    when: {
      workspaceId: 'workspace-1',
      replyToMessageId: 'message-1',
      agentId: 'specter',
      agentName: 'Specter',
      content: 'I can help with that.',
    },
    expect: [
      messagePostedEvent.create({
        messageId: 'generated',
        workspaceId: 'workspace-1',
        author: {
          type: 'agent',
          displayName: 'Specter',
          agentId: 'specter',
        },
        content: 'I can help with that.',
        parentMessageId: 'message-1',
      }),
    ],
  })
  .handle(async (command) => {
    const content = command.content.trim()

    if (!content) {
      throw new Error('Agent reply content is required')
    }

    return [
      messagePostedEvent.create({
        messageId: crypto.randomUUID(),
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

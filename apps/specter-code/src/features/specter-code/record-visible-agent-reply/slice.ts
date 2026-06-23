import { createCommandSlice } from '@specter-ts/core'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import { postReplyCreatedEvent } from '../events'

const recordVisibleAgentReply = createCommandSlice(
  'recordVisibleAgentReply',
  'Records an Agent Run response as a visible reply in the workspace chat.',
)
  .schema(
    z.object({
      workspaceId: z.string(),
      parentPostId: z.string(),
      runId: z.string(),
      agentId: z.string(),
      agentName: z.string(),
      content: z.string(),
    }),
  )
  .store(createMemorySliceStore(() => ({})))
  .scenarios(
    {
      description: 'Records a completed Agent Run as a visible agent reply.',
      given: [],
      when: {
        workspaceId: 'workspace-1',
        parentPostId: 'post-1',
        runId: 'run-1',
        agentId: 'specter',
        agentName: 'Specter',
        content: 'I found the failing test.',
      },
      expect: [
        postReplyCreatedEvent.create({
          replyId: 'generated',
          workspaceId: 'workspace-1',
          parentPostId: 'post-1',
          author: {
            type: 'agent',
            agentId: 'specter',
            displayName: 'Specter',
          },
          content: 'I found the failing test.',
          sourceRunId: 'run-1',
        }),
      ],
    },
    {
      description: 'Rejects a blank visible agent reply.',
      given: [],
      when: {
        workspaceId: 'workspace-1',
        parentPostId: 'post-1',
        runId: 'run-1',
        agentId: 'specter',
        agentName: 'Specter',
        content: '   ',
      },
      expect: [],
      reject: { reason: 'Agent reply content is required' },
    },
  )
  .handle(async (command) => {
    const content = command.content.trim()

    if (!content) {
      throw new Error('Agent reply content is required')
    }

    return [
      postReplyCreatedEvent.create({
        replyId: crypto.randomUUID(),
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

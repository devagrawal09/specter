import { createCommandSlice } from '@specter-ts/core'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import { agentRunRequestedEvent } from '../events'

const requestAgentRun = createCommandSlice(
  'requestAgentRun',
  'Requests an Agent Run for workspace agent work.',
)
  .schema(
    z.object({
      workspaceId: z.string(),
      postId: z.string().optional(),
      agentId: z.string(),
      agentName: z.string(),
      requestedBy: z.discriminatedUnion('type', [
        z.object({
          type: z.literal('user'),
          userId: z.string().optional(),
          displayName: z.string(),
        }),
        z.object({
          type: z.literal('agent'),
          agentId: z.string(),
          displayName: z.string(),
        }),
        z.object({
          type: z.literal('system'),
        }),
      ]),
    }),
  )
  .store(createMemorySliceStore(() => ({})))
  .scenarios(
    {
      description: 'Requests an Agent Run for a workspace post.',
      given: [],
      when: {
        workspaceId: 'workspace-1',
        postId: 'post-1',
        agentId: 'specter',
        agentName: 'Specter',
        requestedBy: { type: 'user', userId: 'user-1', displayName: 'Ada' },
      },
      expect: [
        agentRunRequestedEvent.create({
          runId: 'generated',
          workspaceId: 'workspace-1',
          postId: 'post-1',
          agentId: 'specter',
          agentName: 'Specter',
          requestedBy: { type: 'user', userId: 'user-1', displayName: 'Ada' },
        }),
      ],
    },
    {
      description: 'Requests a system Agent Run without a post target.',
      given: [],
      when: {
        workspaceId: 'workspace-1',
        agentId: 'specter',
        agentName: 'Specter',
        requestedBy: { type: 'system' },
      },
      expect: [
        agentRunRequestedEvent.create({
          runId: 'generated',
          workspaceId: 'workspace-1',
          agentId: 'specter',
          agentName: 'Specter',
          requestedBy: { type: 'system' },
        }),
      ],
    },
  )
  .handle(async (command) => {
    const agentName = command.agentName.trim()

    if (!agentName) {
      throw new Error('Agent name is required')
    }

    return [
      agentRunRequestedEvent.create({
        runId: crypto.randomUUID(),
        workspaceId: command.workspaceId,
        postId: command.postId,
        agentId: command.agentId,
        agentName,
        requestedBy: command.requestedBy,
      }),
    ]
  })

export default requestAgentRun

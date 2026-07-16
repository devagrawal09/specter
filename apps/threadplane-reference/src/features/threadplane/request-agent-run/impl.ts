import requestAgentRunSpec from './spec'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import { agentRunRequestedEvent } from '../events'

const requestAgentRun = requestAgentRunSpec
  .inputSchema(
    z.object({
      runId: z.string(),
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
  .handle(async (command) => {
    const agentName = command.agentName.trim()

    if (!agentName) {
      throw new Error('Agent name is required')
    }

    return [
      agentRunRequestedEvent.create({
        runId: command.runId,
        workspaceId: command.workspaceId,
        postId: command.postId,
        agentId: command.agentId,
        agentName,
        requestedBy: command.requestedBy,
      }),
    ]
  })

export default requestAgentRun

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
      requestedBy: z.object({
        type: z.enum(['user', 'workspace', 'system']),
        userId: z.string().optional(),
        displayName: z.string().optional(),
      }),
    }),
  )
  .store(createMemorySliceStore(() => ({})))
  .handle(async (command) => [
    agentRunRequestedEvent.create({
      runId: crypto.randomUUID(),
      workspaceId: command.workspaceId,
      postId: command.postId,
      agentId: command.agentId,
      agentName: command.agentName,
      requestedBy: command.requestedBy,
    }),
  ])

export default requestAgentRun

import specification from './spec.json' with { type: 'json' }
import { implementCommand } from '@specter-ts/core'
import { z } from 'zod'

import { defineMemorySliceStore } from '../../../testing/memory-slice-store'
import { agentRunStreamedEvent } from '../events'

const recordAgentRunStreamed = implementCommand(specification)
  .inputSchema(
    z.object({
      runId: z.string(),
      workspaceId: z.string(),
      agentId: z.string(),
      chunkId: z.string(),
      sequence: z.number().int().nonnegative(),
      delta: z.string(),
    }),
  )
  .store(defineMemorySliceStore(() => ({})))
  .handle(async (command) => {
    const delta = command.delta

    if (!delta) {
      throw new Error('Streamed delta is required')
    }

    return [
      agentRunStreamedEvent.create({
        runId: command.runId,
        workspaceId: command.workspaceId,
        agentId: command.agentId,
        chunkId: command.chunkId,
        sequence: command.sequence,
        delta,
      }),
    ]
  })

export default recordAgentRunStreamed

import specification from './spec.json' with { type: 'json' }
import { implementCommand } from '@specter-ts/core'
import { z } from 'zod'

import { defineMemorySliceStore } from '../../../testing/memory-slice-store'
import { toolCallFailedEvent, toolCallStartedEvent } from '../events'

const recordToolCallFailed = implementCommand(specification)
  .inputSchema(
    z.object({
      toolCallId: z.string(),
      runId: z.string(),
      workspaceId: z.string(),
      agentId: z.string(),
      toolName: z.string(),
      error: z.string(),
    }),
  )
  .store(defineMemorySliceStore(() => ({})))
  .apply(toolCallStartedEvent, async () => {})
  .handle(async (command) => {
    const error = command.error.trim()

    if (!error) {
      throw new Error('Tool call error is required')
    }

    return [
      toolCallFailedEvent.create({
        toolCallId: command.toolCallId,
        runId: command.runId,
        workspaceId: command.workspaceId,
        agentId: command.agentId,
        toolName: command.toolName,
        error,
      }),
    ]
  })

export default recordToolCallFailed

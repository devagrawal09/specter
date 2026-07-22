import specification from './spec.json' with { type: 'json' }
import { implementCommand } from '@specter-ts/core'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import { toolCallStartedEvent } from '../events'

const recordToolCallStarted = implementCommand<'recordToolCallStarted'>(
  specification,
)
  .inputSchema(
    z.object({
      toolCallId: z.string(),
      runId: z.string(),
      workspaceId: z.string(),
      agentId: z.string(),
      toolName: z.string(),
      inputSummary: z.string().optional(),
    }),
  )
  .store(createMemorySliceStore(() => ({})))
  .handle(async (command) => {
    return [
      toolCallStartedEvent.create({
        toolCallId: command.toolCallId,
        runId: command.runId,
        workspaceId: command.workspaceId,
        agentId: command.agentId,
        toolName: command.toolName,
        inputSummary: command.inputSummary,
      }),
    ]
  })

export default recordToolCallStarted

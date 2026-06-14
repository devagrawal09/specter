import { createCommandSlice } from '@specter-ts/core'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import { toolCallCompletedEvent, toolCallStartedEvent } from '../events'

const recordToolCallCompleted = createCommandSlice(
  'recordToolCallCompleted',
  'Records that an Agent Run tool call completed.',
)
  .schema(
    z.object({
      toolCallId: z.string(),
      runId: z.string(),
      workspaceId: z.string(),
      agentId: z.string(),
      toolName: z.string(),
      outputSummary: z.string().optional(),
    }),
  )
  .store(createMemorySliceStore(() => ({})))
  .scenarios({
    description: 'Records successful completion of a tool call.',
    given: [
      toolCallStartedEvent.create({
        toolCallId: 'tool-call-1',
        runId: 'run-1',
        workspaceId: 'workspace-1',
        agentId: 'specter',
        toolName: 'readFile',
        inputSummary: 'Read src/index.ts',
      }),
    ],
    when: {
      toolCallId: 'tool-call-1',
      runId: 'run-1',
      workspaceId: 'workspace-1',
      agentId: 'specter',
      toolName: 'readFile',
      outputSummary: 'Read 9 bytes from src/index.ts',
    },
    expect: [
      toolCallCompletedEvent.create({
        toolCallId: 'tool-call-1',
        runId: 'run-1',
        workspaceId: 'workspace-1',
        agentId: 'specter',
        toolName: 'readFile',
        outputSummary: 'Read 9 bytes from src/index.ts',
      }),
    ],
  })
  .handle(async () => {
    throw new Error('TODO: implement recordToolCallCompleted')
  })

export default recordToolCallCompleted

import { createCommandSlice } from '@specter-ts/core'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import { toolCallStartedEvent } from '../events'

const recordToolCallStarted = createCommandSlice(
  'recordToolCallStarted',
  'Records that an Agent Run tool call started.',
)
  .schema(
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
  .scenarios({
    description: 'Records the start of a tool call from an Agent Run.',
    given: [],
    when: {
      toolCallId: 'tool-call-1',
      runId: 'run-1',
      workspaceId: 'workspace-1',
      agentId: 'specter',
      toolName: 'readFile',
      inputSummary: 'Read src/index.ts',
    },
    expect: [
      toolCallStartedEvent.create({
        toolCallId: 'tool-call-1',
        runId: 'run-1',
        workspaceId: 'workspace-1',
        agentId: 'specter',
        toolName: 'readFile',
        inputSummary: 'Read src/index.ts',
      }),
    ],
  })
  .handle(async () => {
    throw new Error('TODO: implement recordToolCallStarted')
  })

export default recordToolCallStarted

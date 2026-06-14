import { createCommandSlice } from '@specter-ts/core'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import { toolCallFailedEvent, toolCallStartedEvent } from '../events'

const recordToolCallFailed = createCommandSlice(
  'recordToolCallFailed',
  'Records that an Agent Run tool call failed.',
)
  .schema(
    z.object({
      toolCallId: z.string(),
      runId: z.string(),
      workspaceId: z.string(),
      agentId: z.string(),
      toolName: z.string(),
      error: z.string(),
    }),
  )
  .store(createMemorySliceStore(() => ({})))
  .scenarios({
    description: 'Records a failed tool call with its error message.',
    given: [
      toolCallStartedEvent.create({
        toolCallId: 'tool-call-1',
        runId: 'run-1',
        workspaceId: 'workspace-1',
        agentId: 'specter',
        toolName: 'readFile',
        inputSummary: 'Read missing.ts',
      }),
    ],
    when: {
      toolCallId: 'tool-call-1',
      runId: 'run-1',
      workspaceId: 'workspace-1',
      agentId: 'specter',
      toolName: 'readFile',
      error: 'File not found',
    },
    expect: [
      toolCallFailedEvent.create({
        toolCallId: 'tool-call-1',
        runId: 'run-1',
        workspaceId: 'workspace-1',
        agentId: 'specter',
        toolName: 'readFile',
        error: 'File not found',
      }),
    ],
  })
  .handle(async () => {
    throw new Error('TODO: implement recordToolCallFailed')
  })

export default recordToolCallFailed

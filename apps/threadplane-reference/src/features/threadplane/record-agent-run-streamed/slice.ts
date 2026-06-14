import { createCommandSlice } from '@specter-ts/core'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import { agentRunStreamedEvent } from '../events'

const recordAgentRunStreamed = createCommandSlice(
  'recordAgentRunStreamed',
  'Records streamed Agent Run text output.',
)
  .schema(
    z.object({
      runId: z.string(),
      workspaceId: z.string(),
      agentId: z.string(),
      chunkId: z.string(),
      sequence: z.number().int().nonnegative(),
      delta: z.string(),
    }),
  )
  .store(createMemorySliceStore(() => ({})))
  .scenarios({
    description: 'Records a streamed text chunk from an Agent Run.',
    given: [],
    when: {
      runId: 'run-1',
      workspaceId: 'workspace-1',
      agentId: 'specter',
      chunkId: 'chunk-1',
      sequence: 0,
      delta: 'I found ',
    },
    expect: [
      agentRunStreamedEvent.create({
        runId: 'run-1',
        workspaceId: 'workspace-1',
        agentId: 'specter',
        chunkId: 'chunk-1',
        sequence: 0,
        delta: 'I found ',
      }),
    ],
  })
  .handle(async () => {
    throw new Error('TODO: implement recordAgentRunStreamed')
  })

export default recordAgentRunStreamed

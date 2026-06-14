import { createCommandSlice } from '@specter-ts/core'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import { agentRunFailedEvent } from '../events'

const recordAgentRunFailed = createCommandSlice(
  'recordAgentRunFailed',
  'Records that an Agent Run failed.',
)
  .schema(
    z.object({
      runId: z.string(),
      workspaceId: z.string(),
      agentId: z.string(),
      error: z.string(),
    }),
  )
  .store(createMemorySliceStore(() => ({})))
  .scenarios({
    description: 'Records a failed Agent Run with its error message.',
    given: [],
    when: {
      runId: 'run-1',
      workspaceId: 'workspace-1',
      agentId: 'specter',
      error: 'Agent runtime unavailable',
    },
    expect: [
      agentRunFailedEvent.create({
        runId: 'run-1',
        workspaceId: 'workspace-1',
        agentId: 'specter',
        error: 'Agent runtime unavailable',
      }),
    ],
  })
  .handle(async () => {
    throw new Error('TODO: implement recordAgentRunFailed')
  })

export default recordAgentRunFailed

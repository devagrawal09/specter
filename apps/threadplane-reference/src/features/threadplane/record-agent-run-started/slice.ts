import { createCommandSlice } from '@specter-ts/core'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import { agentRunStartedEvent } from '../events'

const recordAgentRunStarted = createCommandSlice(
  'recordAgentRunStarted',
  'Records that an Agent Run started.',
)
  .schema(
    z.object({
      runId: z.string(),
      workspaceId: z.string(),
      agentId: z.string(),
    }),
  )
  .store(createMemorySliceStore(() => ({})))
  .scenarios({
    description: 'Records the start of a requested Agent Run.',
    given: [],
    when: {
      runId: 'run-1',
      workspaceId: 'workspace-1',
      agentId: 'specter',
    },
    expect: [
      agentRunStartedEvent.create({
        runId: 'run-1',
        workspaceId: 'workspace-1',
        agentId: 'specter',
      }),
    ],
  })
  .handle(async () => {
    throw new Error('TODO: implement recordAgentRunStarted')
  })

export default recordAgentRunStarted

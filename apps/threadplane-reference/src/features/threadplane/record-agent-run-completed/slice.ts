import { createCommandSlice } from '@specter-ts/core'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import { agentRunCompletedEvent } from '../events'

const recordAgentRunCompleted = createCommandSlice(
  'recordAgentRunCompleted',
  'Records that an Agent Run completed.',
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
    description: 'Records successful completion of an Agent Run.',
    given: [],
    when: {
      runId: 'run-1',
      workspaceId: 'workspace-1',
      agentId: 'specter',
    },
    expect: [
      agentRunCompletedEvent.create({
        runId: 'run-1',
        workspaceId: 'workspace-1',
        agentId: 'specter',
      }),
    ],
  })
  .handle(async (command) => {
    return [
      agentRunCompletedEvent.create({
        runId: command.runId,
        workspaceId: command.workspaceId,
        agentId: command.agentId,
      }),
    ]
  })

export default recordAgentRunCompleted

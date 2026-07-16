import { createCommandSlice, event } from '@specter-ts/core/spec'

const recordAgentRunStartedSpec = createCommandSlice('recordAgentRunStarted')
  .description('Records that an Agent Run started.')
  .scenarios({
    description: 'Records the start of a requested Agent Run.',
    given: [],
    when: {
      runId: 'run-1',
      workspaceId: 'workspace-1',
      agentId: 'specter',
    },
    expect: [
      event('agent-run-started', {
        runId: 'run-1',
        workspaceId: 'workspace-1',
        agentId: 'specter',
      }),
    ],
  })

export default recordAgentRunStartedSpec

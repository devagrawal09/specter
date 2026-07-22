import { createCommandSlice, event } from '@specter-ts/spec'

const recordAgentRunFailedSpec = createCommandSlice('recordAgentRunFailed')
  .description('Records that an Agent Run failed.')
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
      event('agent-run-failed', {
        runId: 'run-1',
        workspaceId: 'workspace-1',
        agentId: 'specter',
        error: 'Agent runtime unavailable',
      }),
    ],
  })

export default recordAgentRunFailedSpec

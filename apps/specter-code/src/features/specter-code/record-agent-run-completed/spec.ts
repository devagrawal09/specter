import { createCommandSlice, event } from '@specter-ts/core/spec'

const recordAgentRunCompletedSpec = createCommandSlice('recordAgentRunCompleted')
  .description('Records that an Agent Run completed.')
  .scenarios(
    {
        description: 'Records successful completion of an Agent Run.',
        given: [],
        when: {
          runId: 'run-1',
          workspaceId: 'workspace-1',
          agentId: 'specter',
        },
        expect: [
          event('agent-run-completed', {
            runId: 'run-1',
            workspaceId: 'workspace-1',
            agentId: 'specter',
          }),
        ],
      }
  )

export default recordAgentRunCompletedSpec

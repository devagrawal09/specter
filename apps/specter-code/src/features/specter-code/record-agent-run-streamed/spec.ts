import { createCommandSlice, event } from '@specter-ts/core/spec'

const recordAgentRunStreamedSpec = createCommandSlice('recordAgentRunStreamed')
  .description('Records streamed Agent Run text output.')
  .scenarios(
    {
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
          event('agent-run-streamed', {
            runId: 'run-1',
            workspaceId: 'workspace-1',
            agentId: 'specter',
            chunkId: 'chunk-1',
            sequence: 0,
            delta: 'I found ',
          }),
        ],
      }
  )

export default recordAgentRunStreamedSpec

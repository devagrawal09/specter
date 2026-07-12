import { createCommandSlice, event } from '@specter-ts/core/spec'

const recordToolCallStartedSpec = createCommandSlice('recordToolCallStarted')
  .description('Records that an Agent Run tool call started.')
  .scenarios(
    {
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
          event('tool-call-started', {
            toolCallId: 'tool-call-1',
            runId: 'run-1',
            workspaceId: 'workspace-1',
            agentId: 'specter',
            toolName: 'readFile',
            inputSummary: 'Read src/index.ts',
          }),
        ],
      }
  )

export default recordToolCallStartedSpec

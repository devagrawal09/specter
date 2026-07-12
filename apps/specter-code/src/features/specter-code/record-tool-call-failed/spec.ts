import { createCommandSlice, event } from '@specter-ts/core/spec'

const recordToolCallFailedSpec = createCommandSlice('recordToolCallFailed')
  .description('Records that an Agent Run tool call failed.')
  .scenarios(
    {
        description: 'Records a failed tool call with its error message.',
        given: [
          event('tool-call-started', {
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
          event('tool-call-failed', {
            toolCallId: 'tool-call-1',
            runId: 'run-1',
            workspaceId: 'workspace-1',
            agentId: 'specter',
            toolName: 'readFile',
            error: 'File not found',
          }),
        ],
      }
  )

export default recordToolCallFailedSpec

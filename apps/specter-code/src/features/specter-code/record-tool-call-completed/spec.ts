import { createCommandSlice, event } from '@specter-ts/spec'

const recordToolCallCompletedSpec = createCommandSlice(
  'recordToolCallCompleted',
)
  .description('Records that an Agent Run tool call completed.')
  .scenarios({
    description: 'Records successful completion of a tool call.',
    given: [
      event('tool-call-started', {
        toolCallId: 'tool-call-1',
        runId: 'run-1',
        workspaceId: 'workspace-1',
        agentId: 'specter',
        toolName: 'readFile',
        inputSummary: 'Read src/index.ts',
      }),
    ],
    when: {
      toolCallId: 'tool-call-1',
      runId: 'run-1',
      workspaceId: 'workspace-1',
      agentId: 'specter',
      toolName: 'readFile',
      outputSummary: 'Read 9 bytes from src/index.ts',
    },
    expect: [
      event('tool-call-completed', {
        toolCallId: 'tool-call-1',
        runId: 'run-1',
        workspaceId: 'workspace-1',
        agentId: 'specter',
        toolName: 'readFile',
        outputSummary: 'Read 9 bytes from src/index.ts',
      }),
    ],
  })

export default recordToolCallCompletedSpec

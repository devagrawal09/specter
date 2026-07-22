import { createQuerySlice, event } from '@specter-ts/spec'

const agentRunTimelineSpec = createQuerySlice('agentRunTimeline')
  .description('Shows streamed text chunks and tool calls for one Agent Run.')
  .scenarios(
    {
      description:
        'Shows streamed text and terminal tool call statuses for an Agent Run.',
      given: [
        event('agent-run-streamed', {
          runId: 'run-1',
          workspaceId: 'workspace-1',
          agentId: 'specter',
          chunkId: 'chunk-1',
          sequence: 0,
          delta: 'I found ',
        }),
        event('tool-call-started', {
          toolCallId: 'tool-call-1',
          runId: 'run-1',
          workspaceId: 'workspace-1',
          agentId: 'specter',
          toolName: 'readFile',
          inputSummary: 'Read src/index.ts',
        }),
        event('tool-call-completed', {
          toolCallId: 'tool-call-1',
          runId: 'run-1',
          workspaceId: 'workspace-1',
          agentId: 'specter',
          toolName: 'readFile',
          outputSummary: 'Read 9 bytes from src/index.ts',
        }),
        event('tool-call-started', {
          toolCallId: 'tool-call-2',
          runId: 'run-1',
          workspaceId: 'workspace-1',
          agentId: 'specter',
          toolName: 'readFile',
          inputSummary: 'Read missing.ts',
        }),
        event('tool-call-failed', {
          toolCallId: 'tool-call-2',
          runId: 'run-1',
          workspaceId: 'workspace-1',
          agentId: 'specter',
          toolName: 'readFile',
          error: 'File not found',
        }),
        event('agent-run-streamed', {
          runId: 'run-1',
          workspaceId: 'workspace-1',
          agentId: 'specter',
          chunkId: 'chunk-2',
          sequence: 1,
          delta: 'the issue.',
        }),
      ],
      when: { workspaceId: 'workspace-1', runId: 'run-1' },
      expect: {
        chunks: [
          { chunkId: 'chunk-1', sequence: 0, delta: 'I found ' },
          { chunkId: 'chunk-2', sequence: 1, delta: 'the issue.' },
        ],
        toolCalls: [
          {
            toolCallId: 'tool-call-1',
            toolName: 'readFile',
            status: 'completed',
            inputSummary: 'Read src/index.ts',
            outputSummary: 'Read 9 bytes from src/index.ts',
          },
          {
            toolCallId: 'tool-call-2',
            toolName: 'readFile',
            status: 'failed',
            inputSummary: 'Read missing.ts',
            error: 'File not found',
          },
        ],
      },
    },
    {
      description: 'Shows a running tool call before it completes or fails.',
      given: [
        event('tool-call-started', {
          toolCallId: 'tool-call-1',
          runId: 'run-2',
          workspaceId: 'workspace-1',
          agentId: 'specter',
          toolName: 'searchFiles',
          inputSummary: 'Search for TODO',
        }),
      ],
      when: { workspaceId: 'workspace-1', runId: 'run-2' },
      expect: {
        chunks: [],
        toolCalls: [
          {
            toolCallId: 'tool-call-1',
            toolName: 'searchFiles',
            status: 'running',
            inputSummary: 'Search for TODO',
          },
        ],
      },
    },
  )

export default agentRunTimelineSpec

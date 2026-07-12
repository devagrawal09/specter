import { createReactionSlice, event } from '@specter-ts/core/spec'

const runRequestedAgentRunSpec = createReactionSlice('runRequestedAgentRun')
  .description('Executes requested Agent Runs through the configured agent plugin.')
  .scenarios(
{
      description: 'Queues a requested Agent Run that has not started.',
      given: [
        event('agent-run-requested', {
          runId: 'run-1',
          workspaceId: 'workspace-1',
          postId: 'post-1',
          agentId: 'specter',
          agentName: 'Specter',
          requestedBy: { type: 'user', displayName: 'Ada' },
        }),
      ],
      expect: [
        {
          type: 'recordAgentRunStarted',
          payload: {
            runId: 'run-1',
            workspaceId: 'workspace-1',
            agentId: 'specter',
          },
        },
      ],
    },
    {
      description: 'Continues an Agent Run that already started.',
      given: [
        event('agent-run-requested', {
          runId: 'run-1',
          workspaceId: 'workspace-1',
          agentId: 'specter',
          agentName: 'Specter',
          requestedBy: { type: 'system' },
        }),
        event('agent-run-started', {
          runId: 'run-1',
          workspaceId: 'workspace-1',
          agentId: 'specter',
        }),
      ],
      expect: [
        {
          type: 'recordToolCallStarted',
          payload: {
            toolCallId: 'run-1-tool-1',
            runId: 'run-1',
            workspaceId: 'workspace-1',
            agentId: 'specter',
            toolName: 'searchFiles',
            inputSummary: 'Simulated workspace inspection',
          },
        },
      ],
    },
    {
      description:
        'Does not queue an Agent Run that already reached a terminal state.',
      given: [
        event('agent-run-requested', {
          runId: 'run-1',
          workspaceId: 'workspace-1',
          agentId: 'specter',
          agentName: 'Specter',
          requestedBy: { type: 'system' },
        }),
        event('agent-run-failed', {
          runId: 'run-1',
          workspaceId: 'workspace-1',
          agentId: 'specter',
          error: 'Agent runtime unavailable',
        }),
        event('agent-run-requested', {
          runId: 'run-2',
          workspaceId: 'workspace-1',
          agentId: 'specter',
          agentName: 'Specter',
          requestedBy: { type: 'system' },
        }),
        event('agent-run-completed', {
          runId: 'run-2',
          workspaceId: 'workspace-1',
          agentId: 'specter',
        }),
      ],
      expect: [],
    },
    {
      description: 'Stops after a prompt run completes its approved tool flow.',
      given: [
        event('user-message-submitted', {
          messageId: 'message-approved-1',
          sessionId: 'session-approved-1',
          workspaceId: 'workspace-1',
          content: 'Run the approved tool',
          submittedBy: { userId: 'user-1', displayName: 'Ada Lovelace' },
        }),
        event('agent-run-requested', {
          runId: 'run-approved-1',
          workspaceId: 'workspace-1',
          postId: 'message-approved-1',
          agentId: 'specter',
          agentName: 'Specter',
          requestedBy: { type: 'user', displayName: 'Ada Lovelace' },
        }),
        event('agent-run-started', {
          runId: 'run-approved-1',
          workspaceId: 'workspace-1',
          agentId: 'specter',
        }),
        event('tool-call-started', {
          toolCallId: 'run-approved-1-tool-1',
          runId: 'run-approved-1',
          workspaceId: 'workspace-1',
          agentId: 'specter',
          toolName: 'shell',
          inputSummary: 'Run tests',
        }),
        event('tool-approval-requested', {
          requestId: 'approval-approved-1',
          sessionId: 'session-approved-1',
          messageId: 'message-approved-1',
          workspaceId: 'workspace-1',
          agentId: 'specter',
          toolCallId: 'run-approved-1-tool-1',
          toolName: 'shell',
          permission: 'shell.execute',
          target: 'pnpm test',
          reason: 'Shell command requires approval',
        }),
        event('tool-approval-replied', {
          requestId: 'approval-approved-1',
          sessionId: 'session-approved-1',
          action: 'allow',
          repliedBy: { userId: 'user-1', displayName: 'Ada Lovelace' },
        }),
        event('tool-call-completed', {
          toolCallId: 'run-approved-1-tool-1',
          runId: 'run-approved-1',
          workspaceId: 'workspace-1',
          agentId: 'specter',
          toolName: 'shell',
          outputSummary: 'Tests passed',
        }),
        event('tool-call-failed', {
          toolCallId: 'run-approved-1-tool-1',
          runId: 'run-approved-1',
          workspaceId: 'workspace-1',
          agentId: 'specter',
          toolName: 'shell',
          error: 'Superseded failure record',
        }),
        event('agent-run-streamed', {
          runId: 'run-approved-1',
          workspaceId: 'workspace-1',
          agentId: 'specter',
          chunkId: 'run-approved-1-chunk-1',
          sequence: 0,
          delta: 'Done',
        }),
        event('agent-run-completed', {
          runId: 'run-approved-1',
          workspaceId: 'workspace-1',
          agentId: 'specter',
        }),
      ],
      expect: [],
    },
  )

export default runRequestedAgentRunSpec

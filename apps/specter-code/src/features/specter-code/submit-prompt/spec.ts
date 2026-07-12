import { createCommandSlice, event } from '@specter-ts/core/spec'

const submitPromptSpec = createCommandSlice('submitPrompt')
  .description('Records a user prompt and requests a coding-agent turn.')
  .scenarios(
{
      description: 'Records a prompt and requests an agent run for the session.',
      given: [],
      when: {
        messageId: 'message-1',
        runId: 'run-1',
        sessionId: 'session-1',
        workspaceId: 'workspace-1',
        content: '  add a test and run it  ',
        agentId: 'build',
        agentName: 'Build Agent',
        submittedBy: { userId: 'user-1', displayName: 'Ada Lovelace' },
      },
      expect: [
        event('user-message-submitted', {
          messageId: 'message-1',
          sessionId: 'session-1',
          workspaceId: 'workspace-1',
          content: 'add a test and run it',
          submittedBy: { userId: 'user-1', displayName: 'Ada Lovelace' },
        }),
        event('agent-run-requested', {
          runId: 'run-1',
          workspaceId: 'workspace-1',
          postId: 'message-1',
          agentId: 'build',
          agentName: 'Build Agent',
          requestedBy: { type: 'user', userId: 'user-1', displayName: 'Ada Lovelace' },
        }),
      ],
    },
    {
      description: 'Rejects a blank prompt.',
      given: [],
      when: {
        messageId: 'message-invalid',
        runId: 'run-invalid',
        sessionId: 'session-1',
        workspaceId: 'workspace-1',
        content: '   ',
        agentId: 'build',
        agentName: 'Build Agent',
        submittedBy: { displayName: 'Ada Lovelace' },
      },
      expect: [],
      reject: { reason: 'Prompt content is required' },
    },
  )

export default submitPromptSpec

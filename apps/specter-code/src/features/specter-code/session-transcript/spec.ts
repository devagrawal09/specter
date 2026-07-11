import { createQuerySlice, event } from '@specter-ts/core/spec'

const sessionTranscriptSpec = createQuerySlice('sessionTranscript')
  .description('Lists transcript items for a coding-agent session.')
  .scenarios(
{
      description: 'Lists user messages for the requested session in submission order.',
      given: [
        event('user-message-submitted', {
          messageId: 'message-1',
          sessionId: 'session-1',
          workspaceId: 'workspace-1',
          content: 'add a test',
          submittedBy: { userId: 'user-1', displayName: 'Ada Lovelace' },
        }),
        event('user-message-submitted', {
          messageId: 'message-2',
          sessionId: 'session-2',
          workspaceId: 'workspace-1',
          content: 'other session',
          submittedBy: { displayName: 'Ada Lovelace' },
        }),
        event('user-message-submitted', {
          messageId: 'message-3',
          sessionId: 'session-1',
          workspaceId: 'workspace-1',
          content: 'run it',
          submittedBy: { userId: 'user-1', displayName: 'Ada Lovelace' },
        }),
      ],
      when: { sessionId: 'session-1' },
      expect: [
        {
          id: 'message-1',
          sessionId: 'session-1',
          workspaceId: 'workspace-1',
          role: 'user',
          content: 'add a test',
          author: { userId: 'user-1', displayName: 'Ada Lovelace' },
        },
        {
          id: 'message-3',
          sessionId: 'session-1',
          workspaceId: 'workspace-1',
          role: 'user',
          content: 'run it',
          author: { userId: 'user-1', displayName: 'Ada Lovelace' },
        },
      ],
    },
    {
      description: 'Includes assistant replies produced by runs for session prompts.',
      given: [
        event('user-message-submitted', {
          messageId: 'message-assistant-1',
          sessionId: 'session-assistant',
          workspaceId: 'workspace-1',
          content: 'add a test',
          submittedBy: { userId: 'user-1', displayName: 'Ada Lovelace' },
        }),
        event('agent-run-requested', {
          runId: 'run-assistant-1',
          workspaceId: 'workspace-1',
          postId: 'message-assistant-1',
          agentId: 'build',
          agentName: 'Build Agent',
          requestedBy: { type: 'user', userId: 'user-1', displayName: 'Ada Lovelace' },
        }),
        event('post-reply-created', {
          replyId: 'reply-assistant-1',
          workspaceId: 'workspace-1',
          parentPostId: 'message-assistant-1',
          author: { type: 'agent', agentId: 'build', displayName: 'Build Agent' },
          content: 'I added the regression test.',
          sourceRunId: 'run-assistant-1',
        }),
      ],
      when: { sessionId: 'session-assistant' },
      expect: [
        {
          id: 'message-assistant-1',
          sessionId: 'session-assistant',
          workspaceId: 'workspace-1',
          role: 'user',
          content: 'add a test',
          author: { userId: 'user-1', displayName: 'Ada Lovelace' },
        },
        {
          id: 'reply-assistant-1',
          sessionId: 'session-assistant',
          workspaceId: 'workspace-1',
          role: 'assistant',
          content: 'I added the regression test.',
          author: { agentId: 'build', displayName: 'Build Agent' },
        },
      ],
    },
    {
      description: 'Applies a text part update to an existing transcript message.',
      given: [
        event('user-message-submitted', {
          messageId: 'message-update-1',
          sessionId: 'session-update',
          workspaceId: 'workspace-1',
          content: 'old prompt',
          submittedBy: { userId: 'user-1', displayName: 'Ada Lovelace' },
        }),
        event('session-message-part-updated', {
          sessionId: 'session-update',
          messageId: 'message-update-1',
          partId: 'part_text',
          content: 'updated prompt',
        }),
      ],
      when: { sessionId: 'session-update' },
      expect: [
        {
          id: 'message-update-1',
          sessionId: 'session-update',
          workspaceId: 'workspace-1',
          role: 'user',
          content: 'updated prompt',
          author: { userId: 'user-1', displayName: 'Ada Lovelace' },
        },
      ],
    },
    {
      description: 'Clears content when a transcript text part is deleted.',
      given: [
        event('user-message-submitted', {
          messageId: 'message-part-delete-1',
          sessionId: 'session-part-delete',
          workspaceId: 'workspace-1',
          content: 'temporary prompt',
          submittedBy: { userId: 'user-1', displayName: 'Ada Lovelace' },
        }),
        event('session-message-part-deleted', {
          sessionId: 'session-part-delete',
          messageId: 'message-part-delete-1',
          partId: 'part_text',
        }),
      ],
      when: { sessionId: 'session-part-delete' },
      expect: [
        {
          id: 'message-part-delete-1',
          sessionId: 'session-part-delete',
          workspaceId: 'workspace-1',
          role: 'user',
          content: '',
          author: { userId: 'user-1', displayName: 'Ada Lovelace' },
        },
      ],
    },
    {
      description: 'Removes a transcript message after session message deletion.',
      given: [
        event('user-message-submitted', {
          messageId: 'message-delete-1',
          sessionId: 'session-delete',
          workspaceId: 'workspace-1',
          content: 'remove me',
          submittedBy: { userId: 'user-1', displayName: 'Ada Lovelace' },
        }),
        event('session-message-deleted', {
          sessionId: 'session-delete',
          messageId: 'message-delete-1',
        }),
      ],
      when: { sessionId: 'session-delete' },
      expect: [],
    },
  )

export default sessionTranscriptSpec

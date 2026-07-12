import { createCommandSlice, event } from '@specter-ts/core/spec'

const recordSessionMessageSpec = createCommandSlice('recordSessionMessage')
  .description('Records a user message in a session without requesting an agent turn.')
  .scenarios(
{
      description: 'Records a no-reply session message without requesting an agent run.',
      given: [],
      when: {
        messageId: 'message-no-reply-1',
        sessionId: 'session-1',
        workspaceId: 'workspace-1',
        content: '  note this context only  ',
        submittedBy: { userId: 'user-1', displayName: 'Ada Lovelace' },
      },
      expect: [
        event('user-message-submitted', {
          messageId: 'message-no-reply-1',
          sessionId: 'session-1',
          workspaceId: 'workspace-1',
          content: 'note this context only',
          submittedBy: { userId: 'user-1', displayName: 'Ada Lovelace' },
        }),
      ],
    },
    {
      description: 'Rejects a blank no-reply message.',
      given: [],
      when: {
        messageId: 'message-invalid',
        sessionId: 'session-1',
        workspaceId: 'workspace-1',
        content: '   ',
        submittedBy: { displayName: 'Ada Lovelace' },
      },
      expect: [],
      reject: { reason: 'Message content is required' },
    },
  )

export default recordSessionMessageSpec

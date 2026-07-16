import { createCommandSlice, event } from '@specter-ts/core/spec'

const deleteSessionMessageSpec = createCommandSlice('deleteSessionMessage')
  .description('Deletes a user-visible session message from the transcript.')
  .scenarios({
    description: 'Records a session message deletion event.',
    given: [],
    when: {
      sessionId: 'session-1',
      messageId: 'message-1',
      deletedBy: { userId: 'user-1', displayName: 'Ada Lovelace' },
    },
    expect: [
      event('session-message-deleted', {
        sessionId: 'session-1',
        messageId: 'message-1',
        deletedBy: { userId: 'user-1', displayName: 'Ada Lovelace' },
      }),
    ],
  })

export default deleteSessionMessageSpec

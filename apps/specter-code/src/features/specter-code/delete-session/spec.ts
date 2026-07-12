import { createCommandSlice, event } from '@specter-ts/core/spec'

const deleteSessionSpec = createCommandSlice('deleteSession')
  .description('Deletes a coding-agent session from active session lists.')
  .scenarios(
{
    description: 'Deletes a session by id.',
    given: [],
    when: {
      sessionId: 'session-1',
      deletedBy: { userId: 'user-1', displayName: 'Ada Lovelace' },
    },
    expect: [
      event('session-deleted', {
        sessionId: 'session-1',
        deletedBy: { userId: 'user-1', displayName: 'Ada Lovelace' },
      }),
    ],
  }
  )

export default deleteSessionSpec

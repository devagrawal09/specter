import { createCommandSlice, event } from '@specter-ts/core/spec'

const updateSessionSpec = createCommandSlice('updateSession')
  .description('Updates mutable metadata for an existing coding-agent session.')
  .scenarios(
    {
      description:
        'Updates session title, directory, agent, and model metadata.',
      given: [],
      when: {
        sessionId: 'session-1',
        title: '  Ship rename  ',
        directory: '/tmp/renamed',
        agent: 'senior',
        model: { providerId: 'anthropic', modelId: 'claude-opus-4.1' },
        updatedBy: { userId: 'user-1', displayName: 'Ada Lovelace' },
      },
      expect: [
        event('session-updated', {
          sessionId: 'session-1',
          title: 'Ship rename',
          directory: '/tmp/renamed',
          agent: 'senior',
          model: { providerId: 'anthropic', modelId: 'claude-opus-4.1' },
          updatedBy: { userId: 'user-1', displayName: 'Ada Lovelace' },
        }),
      ],
    },
    {
      description: 'Rejects an empty update payload.',
      given: [],
      when: { sessionId: 'session-1' },
      expect: [],
      reject: {
        reason: 'Session update must include at least one mutable field',
      },
    },
    {
      description: 'Rejects a blank session title update.',
      given: [],
      when: { sessionId: 'session-1', title: '   ' },
      expect: [],
      reject: { reason: 'Session title is required' },
    },
  )

export default updateSessionSpec

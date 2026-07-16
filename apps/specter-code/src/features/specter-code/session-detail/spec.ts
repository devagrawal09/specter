import { createQuerySlice, event } from '@specter-ts/core/spec'

const sessionDetailSpec = createQuerySlice('sessionDetail')
  .description('Gets a single coding-agent session by id.')
  .scenarios(
    {
      description: 'Returns a created session by id.',
      given: [
        event('session-created', {
          sessionId: 'session-1',
          workspaceId: 'workspace-1',
          title: 'Fix tests',
          directory: '/tmp/project',
          agent: 'build',
          model: {
            providerId: 'openrouter',
            modelId: 'anthropic/claude-sonnet-4',
          },
        }),
      ],
      when: { sessionId: 'session-1' },
      expect: {
        id: 'session-1',
        workspaceId: 'workspace-1',
        title: 'Fix tests',
        directory: '/tmp/project',
        agent: 'build',
        model: {
          providerId: 'openrouter',
          modelId: 'anthropic/claude-sonnet-4',
        },
      },
    },
    {
      description:
        'Returns updated session metadata and hides deleted sessions.',
      given: [
        event('session-created', {
          sessionId: 'session-1',
          workspaceId: 'workspace-1',
          title: 'Fix tests',
          directory: '/tmp/project',
          agent: 'build',
          model: {
            providerId: 'openrouter',
            modelId: 'anthropic/claude-sonnet-4',
          },
        }),
        event('session-updated', {
          sessionId: 'session-1',
          title: 'Renamed session',
          agent: 'senior',
        }),
      ],
      when: { sessionId: 'session-1' },
      expect: {
        id: 'session-1',
        workspaceId: 'workspace-1',
        title: 'Renamed session',
        directory: '/tmp/project',
        agent: 'senior',
        model: {
          providerId: 'openrouter',
          modelId: 'anthropic/claude-sonnet-4',
        },
      },
    },
    {
      description: 'Returns null for a deleted session.',
      given: [
        event('session-created', {
          sessionId: 'session-1',
          workspaceId: 'workspace-1',
          title: 'Fix tests',
          directory: '/tmp/project',
          agent: 'build',
          model: {
            providerId: 'openrouter',
            modelId: 'anthropic/claude-sonnet-4',
          },
        }),
        event('session-deleted', { sessionId: 'session-1' }),
      ],
      when: { sessionId: 'session-1' },
      expect: null,
    },
  )

export default sessionDetailSpec

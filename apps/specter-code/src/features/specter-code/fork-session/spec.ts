import { createCommandSlice, event } from '@specter-ts/core/spec'

const forkSessionSpec = createCommandSlice('forkSession')
  .description('Creates a child session forked from an existing coding-agent session.')
  .scenarios(
{
      description: 'Creates a child session that retains the parent session id.',
      given: [],
      when: {
        sessionId: 'session-parent',
        newSessionId: 'session-child',
        workspaceId: 'workspace-1',
        title: '  Investigate alternative  ',
        directory: '/tmp/project',
        agent: 'build',
        model: { providerId: 'openrouter', modelId: 'anthropic/claude-sonnet-4' },
        createdBy: { userId: 'user-1', displayName: 'Ada Lovelace' },
      },
      expect: [
        event('session-created', {
          sessionId: 'session-child',
          parentSessionId: 'session-parent',
          workspaceId: 'workspace-1',
          title: 'Investigate alternative',
          directory: '/tmp/project',
          agent: 'build',
          model: { providerId: 'openrouter', modelId: 'anthropic/claude-sonnet-4' },
          createdBy: { userId: 'user-1', displayName: 'Ada Lovelace' },
        }),
      ],
    },
    {
      description: 'Rejects a blank fork title.',
      given: [],
      when: {
        sessionId: 'session-parent',
        newSessionId: 'session-invalid-child',
        workspaceId: 'workspace-1',
        title: '   ',
        directory: '/tmp/project',
        agent: 'build',
        model: { providerId: 'openrouter', modelId: 'anthropic/claude-sonnet-4' },
      },
      expect: [],
      reject: { reason: 'Session title is required' },
    },
  )

export default forkSessionSpec

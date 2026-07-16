import { createCommandSlice, event } from '@specter-ts/core/spec'

const createSessionSpec = createCommandSlice('createSession')
  .description('Creates a coding-agent session in a workspace.')
  .scenarios(
    {
      description: 'Creates a session with title, directory, agent, and model.',
      given: [],
      when: {
        sessionId: 'session-1',
        workspaceId: 'workspace-1',
        title: '  Fix tests  ',
        directory: '/tmp/project',
        agent: 'build',
        model: {
          providerId: 'openrouter',
          modelId: 'anthropic/claude-sonnet-4',
        },
        createdBy: { userId: 'user-1', displayName: 'Ada Lovelace' },
      },
      expect: [
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
          createdBy: { userId: 'user-1', displayName: 'Ada Lovelace' },
        }),
      ],
    },
    {
      description: 'Rejects a blank session title.',
      given: [],
      when: {
        sessionId: 'session-invalid',
        workspaceId: 'workspace-1',
        title: '   ',
        directory: '/tmp/project',
        agent: 'build',
        model: {
          providerId: 'openrouter',
          modelId: 'anthropic/claude-sonnet-4',
        },
      },
      expect: [],
      reject: { reason: 'Session title is required' },
    },
  )

export default createSessionSpec

import { createQuerySlice, event } from '@specter-ts/core/spec'

const sessionListSpec = createQuerySlice('sessionList')
  .description('Lists coding-agent sessions for a workspace.')
  .scenarios(
    {
      description:
        'Lists sessions for the requested workspace in creation order.',
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
        event('session-created', {
          sessionId: 'session-2',
          workspaceId: 'workspace-2',
          title: 'Other workspace',
          directory: '/tmp/other',
          agent: 'plan',
          model: { providerId: 'openai', modelId: 'gpt-5.1' },
        }),
        event('session-created', {
          sessionId: 'session-3',
          workspaceId: 'workspace-1',
          title: 'Implement shell tool',
          directory: '/tmp/project',
          agent: 'build',
          model: {
            providerId: 'openrouter',
            modelId: 'anthropic/claude-sonnet-4',
          },
        }),
      ],
      when: { workspaceId: 'workspace-1' },
      expect: [
        {
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
        {
          id: 'session-3',
          workspaceId: 'workspace-1',
          title: 'Implement shell tool',
          directory: '/tmp/project',
          agent: 'build',
          model: {
            providerId: 'openrouter',
            modelId: 'anthropic/claude-sonnet-4',
          },
        },
      ],
    },
    {
      description: 'Lists updated sessions and hides deleted sessions.',
      given: [
        event('session-created', {
          sessionId: 'session-update-1',
          workspaceId: 'workspace-update',
          title: 'Fix tests',
          directory: '/tmp/project',
          agent: 'build',
          model: {
            providerId: 'openrouter',
            modelId: 'anthropic/claude-sonnet-4',
          },
        }),
        event('session-created', {
          sessionId: 'session-update-2',
          workspaceId: 'workspace-update',
          title: 'Delete me',
          directory: '/tmp/project',
          agent: 'build',
          model: {
            providerId: 'openrouter',
            modelId: 'anthropic/claude-sonnet-4',
          },
        }),
        event('session-updated', {
          sessionId: 'session-update-1',
          title: 'Renamed session',
          model: { providerId: 'anthropic', modelId: 'claude-opus-4.1' },
        }),
        event('session-deleted', { sessionId: 'session-update-2' }),
      ],
      when: { workspaceId: 'workspace-update' },
      expect: [
        {
          id: 'session-update-1',
          workspaceId: 'workspace-update',
          title: 'Renamed session',
          directory: '/tmp/project',
          agent: 'build',
          model: { providerId: 'anthropic', modelId: 'claude-opus-4.1' },
        },
      ],
    },
  )

export default sessionListSpec

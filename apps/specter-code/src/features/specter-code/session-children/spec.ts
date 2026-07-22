import { createQuerySlice, event } from '@specter-ts/spec'

const sessionChildrenSpec = createQuerySlice('sessionChildren')
  .description('Lists child sessions forked from a parent session.')
  .scenarios({
    description: 'Lists non-deleted children for the requested parent session.',
    given: [
      event('session-created', {
        sessionId: 'session-parent',
        workspaceId: 'workspace-1',
        title: 'Parent',
        directory: '/tmp/project',
        agent: 'build',
        model: {
          providerId: 'openrouter',
          modelId: 'anthropic/claude-sonnet-4',
        },
      }),
      event('session-created', {
        sessionId: 'session-child-1',
        parentSessionId: 'session-parent',
        workspaceId: 'workspace-1',
        title: 'Child one',
        directory: '/tmp/project',
        agent: 'build',
        model: {
          providerId: 'openrouter',
          modelId: 'anthropic/claude-sonnet-4',
        },
      }),
      event('session-created', {
        sessionId: 'session-child-2',
        parentSessionId: 'session-parent',
        workspaceId: 'workspace-1',
        title: 'Child two',
        directory: '/tmp/project',
        agent: 'build',
        model: {
          providerId: 'openrouter',
          modelId: 'anthropic/claude-sonnet-4',
        },
      }),
      event('session-created', {
        sessionId: 'session-other-child',
        parentSessionId: 'session-other-parent',
        workspaceId: 'workspace-1',
        title: 'Other child',
        directory: '/tmp/project',
        agent: 'build',
        model: {
          providerId: 'openrouter',
          modelId: 'anthropic/claude-sonnet-4',
        },
      }),
      event('session-updated', {
        sessionId: 'session-child-1',
        title: 'Renamed child',
      }),
      event('session-deleted', { sessionId: 'session-child-2' }),
    ],
    when: { sessionId: 'session-parent' },
    expect: [
      {
        id: 'session-child-1',
        parentSessionId: 'session-parent',
        workspaceId: 'workspace-1',
        title: 'Renamed child',
        directory: '/tmp/project',
        agent: 'build',
        model: {
          providerId: 'openrouter',
          modelId: 'anthropic/claude-sonnet-4',
        },
      },
    ],
  })

export default sessionChildrenSpec

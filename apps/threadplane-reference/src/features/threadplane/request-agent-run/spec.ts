import { createCommandSlice, event } from '@specter-ts/spec'

const requestAgentRunSpec = createCommandSlice('requestAgentRun')
  .description('Requests an Agent Run for workspace agent work.')
  .scenarios(
    {
      description: 'Requests an Agent Run for a workspace post.',
      given: [],
      when: {
        runId: 'run-1',
        workspaceId: 'workspace-1',
        postId: 'post-1',
        agentId: 'specter',
        agentName: 'Specter',
        requestedBy: { type: 'user', userId: 'user-1', displayName: 'Ada' },
      },
      expect: [
        event('agent-run-requested', {
          runId: 'run-1',
          workspaceId: 'workspace-1',
          postId: 'post-1',
          agentId: 'specter',
          agentName: 'Specter',
          requestedBy: { type: 'user', userId: 'user-1', displayName: 'Ada' },
        }),
      ],
    },
    {
      description: 'Requests a system Agent Run without a post target.',
      given: [],
      when: {
        runId: 'run-2',
        workspaceId: 'workspace-1',
        agentId: 'specter',
        agentName: 'Specter',
        requestedBy: { type: 'system' },
      },
      expect: [
        event('agent-run-requested', {
          runId: 'run-2',
          workspaceId: 'workspace-1',
          agentId: 'specter',
          agentName: 'Specter',
          requestedBy: { type: 'system' },
        }),
      ],
    },
  )

export default requestAgentRunSpec

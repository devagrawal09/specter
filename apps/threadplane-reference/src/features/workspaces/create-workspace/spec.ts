import { createCommandSlice, event } from '@specter-ts/core/spec'

const createWorkspaceSpec = createCommandSlice('createWorkspace')
  .description('Creates a workspace.')
  .scenarios(
    {
      description: 'Creates a workspace with a trimmed name.',
      given: [],
      when: { workspaceId: 'workspace-1', name: '  Design Lab  ' },
      expect: [
        event('workspace-created', {
          workspaceId: 'workspace-1',
          name: 'Design Lab',
        }),
      ],
    },
    {
      description: 'Rejects a blank workspace name.',
      given: [],
      when: { workspaceId: 'workspace-1', name: '   ' },
      expect: [],
      reject: { reason: 'Workspace name is required' },
    },
  )

export default createWorkspaceSpec

import { createQuerySlice, event } from '@specter-ts/core/spec'

const workspacesQuerySpec = createQuerySlice('workspacesQuery')
  .description('Lists workspaces.')
  .scenarios({
    description: 'Lists workspaces in creation order.',
    given: [
      event('workspace-created', {
        workspaceId: 'workspace-1',
        name: 'Main Workspace',
      }),
      event('workspace-created', {
        workspaceId: 'workspace-2',
        name: 'Design Lab',
      }),
    ],
    when: {},
    expect: [
      { id: 'workspace-1', name: 'Main Workspace' },
      { id: 'workspace-2', name: 'Design Lab' },
    ],
  })

export default workspacesQuerySpec

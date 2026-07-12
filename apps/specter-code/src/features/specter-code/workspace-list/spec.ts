import { createQuerySlice, event } from '@specter-ts/core/spec'

const workspaceListSpec = createQuerySlice('workspaceList')
  .description('Lists workspaces available to the current user.')
  .scenarios(
    {
        description: 'Lists workspaces in creation order.',
        given: [
          event('workspace-created', {
            workspaceId: 'workspace-1',
            name: 'Main Workspace',
            createdBy: { userId: 'user-1', displayName: 'Ada Lovelace' },
          }),
          event('workspace-created', {
            workspaceId: 'workspace-2',
            name: 'Design Lab',
          }),
        ],
        when: {},
        expect: [
          {
            id: 'workspace-1',
            name: 'Main Workspace',
            createdBy: { userId: 'user-1', displayName: 'Ada Lovelace' },
          },
          { id: 'workspace-2', name: 'Design Lab' },
        ],
      }
  )

export default workspaceListSpec

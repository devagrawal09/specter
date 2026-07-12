import { createCommandSlice, event } from '@specter-ts/core/spec'

const createWorkspaceSpec = createCommandSlice('createWorkspace')
  .description('Creates a workspace for posts, agents, and workspace files.')
  .scenarios(
    {
          description:
            'Creates a workspace with a trimmed name and initializes filesystem metadata.',
          given: [],
          when: {
            workspaceId: 'workspace-1',
            scanId: 'scan-1',
            name: '  Design Lab  ',
            createdBy: { userId: 'user-1', displayName: 'Ada Lovelace' },
          },
          expect: [
            event('workspace-created', {
              workspaceId: 'workspace-1',
              name: 'Design Lab',
              createdBy: { userId: 'user-1', displayName: 'Ada Lovelace' },
            }),
            event('workspace-filesystem-initialized', {
              workspaceId: 'workspace-1',
            }),
            event('workspace-filesystem-scan-requested', {
              scanId: 'scan-1',
              workspaceId: 'workspace-1',
              reason: 'workspaceCreated',
              requestedBy: { type: 'system' },
            }),
          ],
        },
    {
          description: 'Rejects a blank workspace name.',
          given: [],
          when: { workspaceId: 'workspace-1', scanId: 'scan-1', name: '   ' },
          expect: [],
          reject: { reason: 'Workspace name is required' },
        }
  )

export default createWorkspaceSpec

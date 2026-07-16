import { createReactionSlice, event } from '@specter-ts/core/spec'

const runRequestedFilesystemScanSpec = createReactionSlice(
  'runRequestedFilesystemScan',
)
  .description(
    'Executes requested workspace filesystem scans through the scan runner.',
  )
  .scenarios(
    {
      description: 'Queues a requested filesystem scan that has not started.',
      given: [
        event('workspace-filesystem-scan-requested', {
          scanId: 'scan-1',
          workspaceId: 'workspace-1',
          reason: 'userRequested',
          requestedBy: { type: 'user', displayName: 'Ada' },
        }),
      ],
      expect: [
        {
          type: 'runWorkspaceFilesystemScan',
          payload: { scanId: 'scan-1', workspaceId: 'workspace-1' },
        },
      ],
    },
    {
      description: 'Does not queue a filesystem scan that already started.',
      given: [
        event('workspace-filesystem-scan-requested', {
          scanId: 'scan-1',
          workspaceId: 'workspace-1',
          reason: 'workspaceCreated',
          requestedBy: { type: 'system' },
        }),
        event('workspace-filesystem-scan-started', {
          scanId: 'scan-1',
          workspaceId: 'workspace-1',
        }),
      ],
      expect: [],
    },
    {
      description:
        'Does not queue a filesystem scan that already completed or failed.',
      given: [
        event('workspace-filesystem-scan-requested', {
          scanId: 'scan-1',
          workspaceId: 'workspace-1',
          reason: 'workspaceCreated',
          requestedBy: { type: 'system' },
        }),
        event('workspace-filesystem-scan-completed', {
          scanId: 'scan-1',
          workspaceId: 'workspace-1',
          discoveredNodeCount: 2,
          changedNodeCount: 0,
          deletedNodeCount: 0,
        }),
        event('workspace-filesystem-scan-requested', {
          scanId: 'scan-2',
          workspaceId: 'workspace-1',
          reason: 'userRequested',
          requestedBy: { type: 'user', displayName: 'Ada' },
        }),
        event('workspace-filesystem-scan-failed', {
          scanId: 'scan-2',
          workspaceId: 'workspace-1',
          error: 'Workspace directory is unavailable',
        }),
      ],
      expect: [],
    },
  )

export default runRequestedFilesystemScanSpec

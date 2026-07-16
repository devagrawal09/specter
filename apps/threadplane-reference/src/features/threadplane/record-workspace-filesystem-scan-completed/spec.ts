import { createCommandSlice, event } from '@specter-ts/core/spec'

const recordWorkspaceFilesystemScanCompletedSpec = createCommandSlice(
  'recordWorkspaceFilesystemScanCompleted',
)
  .description('Records that a workspace filesystem metadata scan completed.')
  .scenarios({
    description: 'Records filesystem scan completion with node totals.',
    given: [],
    when: {
      scanId: 'scan-1',
      workspaceId: 'workspace-1',
      discoveredNodeCount: 3,
      changedNodeCount: 1,
      deletedNodeCount: 1,
    },
    expect: [
      event('workspace-filesystem-scan-completed', {
        scanId: 'scan-1',
        workspaceId: 'workspace-1',
        discoveredNodeCount: 3,
        changedNodeCount: 1,
        deletedNodeCount: 1,
      }),
    ],
  })

export default recordWorkspaceFilesystemScanCompletedSpec

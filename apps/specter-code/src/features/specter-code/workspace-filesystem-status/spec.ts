import { createQuerySlice, event } from '@specter-ts/core/spec'

const workspaceFilesystemStatusSpec = createQuerySlice('workspaceFilesystemStatus')
  .description('Shows filesystem initialization and latest scan status for a workspace.')
  .scenarios(
    {
          description: 'Reports a workspace with no initialized filesystem state.',
          given: [],
          when: { workspaceId: 'workspace-1' },
          expect: { initialized: false, latestScan: null },
        },
    {
          description: 'Reports a requested workspace filesystem scan.',
          given: [
            event('workspace-filesystem-initialized', {
              workspaceId: 'workspace-1',
            }),
            event('workspace-filesystem-scan-requested', {
              scanId: 'scan-1',
              workspaceId: 'workspace-1',
              reason: 'userRequested',
              requestedBy: { type: 'user', userId: 'user-1', displayName: 'Ada' },
            }),
          ],
          when: { workspaceId: 'workspace-1' },
          expect: {
            initialized: true,
            latestScan: {
              scanId: 'scan-1',
              status: 'requested',
              reason: 'userRequested',
              requestedBy: { type: 'user', userId: 'user-1', displayName: 'Ada' },
            },
          },
        },
    {
          description: 'Reports a running workspace filesystem scan.',
          given: [
            event('workspace-filesystem-initialized', {
              workspaceId: 'workspace-1',
            }),
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
          when: { workspaceId: 'workspace-1' },
          expect: {
            initialized: true,
            latestScan: {
              scanId: 'scan-1',
              status: 'running',
              reason: 'workspaceCreated',
              requestedBy: { type: 'system' },
            },
          },
        },
    {
          description: 'Reports a completed workspace filesystem scan.',
          given: [
            event('workspace-filesystem-initialized', {
              workspaceId: 'workspace-1',
            }),
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
            event('workspace-filesystem-scan-completed', {
              scanId: 'scan-1',
              workspaceId: 'workspace-1',
              discoveredNodeCount: 3,
              changedNodeCount: 1,
              deletedNodeCount: 0,
            }),
          ],
          when: { workspaceId: 'workspace-1' },
          expect: {
            initialized: true,
            latestScan: {
              scanId: 'scan-1',
              status: 'completed',
              reason: 'workspaceCreated',
              requestedBy: { type: 'system' },
              discoveredNodeCount: 3,
              changedNodeCount: 1,
              deletedNodeCount: 0,
            },
          },
        },
    {
          description: 'Reports a failed workspace filesystem scan.',
          given: [
            event('workspace-filesystem-initialized', {
              workspaceId: 'workspace-1',
            }),
            event('workspace-filesystem-scan-requested', {
              scanId: 'scan-2',
              workspaceId: 'workspace-1',
              reason: 'userRequested',
              requestedBy: { type: 'user', userId: 'user-1', displayName: 'Ada' },
            }),
            event('workspace-filesystem-scan-failed', {
              scanId: 'scan-2',
              workspaceId: 'workspace-1',
              error: 'Workspace directory is unavailable',
            }),
          ],
          when: { workspaceId: 'workspace-1' },
          expect: {
            initialized: true,
            latestScan: {
              scanId: 'scan-2',
              status: 'failed',
              reason: 'userRequested',
              requestedBy: { type: 'user', userId: 'user-1', displayName: 'Ada' },
              error: 'Workspace directory is unavailable',
            },
          },
        }
  )

export default workspaceFilesystemStatusSpec

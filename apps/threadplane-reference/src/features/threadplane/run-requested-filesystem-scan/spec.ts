import { createReactionSlice, event } from '@specter-ts/spec'

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
          payload: {
            scanId: 'scan-1',
            workspaceId: 'workspace-1',
            baseline: [],
            plannedSnapshot: null,
            progress: { discovered: {}, changed: {}, deleted: {} },
          },
        },
      ],
    },
    {
      description:
        'Resumes a started filesystem scan from its durable plan and committed progress.',
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
          snapshot: [
            {
              path: 'src',
              parentPath: null,
              name: 'src',
              kind: 'directory',
              sizeBytes: null,
            },
            {
              path: 'src/index.ts',
              parentPath: 'src',
              name: 'index.ts',
              kind: 'file',
              sizeBytes: 42,
            },
          ],
        }),
        event('filesystem-node-discovered', {
          scanId: 'scan-1',
          workspaceId: 'workspace-1',
          path: 'src',
          parentPath: null,
          name: 'src',
          kind: 'directory',
          sizeBytes: null,
        }),
        event('filesystem-node-changed', {
          scanId: 'scan-1',
          workspaceId: 'workspace-1',
          path: 'src/index.ts',
          parentPath: 'src',
          name: 'index.ts',
          kind: 'file',
          sizeBytes: 40,
        }),
        event('filesystem-node-deleted', {
          scanId: 'scan-1',
          workspaceId: 'workspace-1',
          path: 'old.ts',
        }),
      ],
      expect: [
        {
          type: 'runWorkspaceFilesystemScan',
          payload: {
            scanId: 'scan-1',
            workspaceId: 'workspace-1',
            baseline: [
              {
                path: 'src',
                parentPath: null,
                name: 'src',
                kind: 'directory',
                sizeBytes: null,
              },
              {
                path: 'src/index.ts',
                parentPath: 'src',
                name: 'index.ts',
                kind: 'file',
                sizeBytes: 40,
              },
            ],
            plannedSnapshot: [
              {
                path: 'src',
                parentPath: null,
                name: 'src',
                kind: 'directory',
                sizeBytes: null,
              },
              {
                path: 'src/index.ts',
                parentPath: 'src',
                name: 'index.ts',
                kind: 'file',
                sizeBytes: 42,
              },
            ],
            progress: {
              discovered: { src: true },
              changed: { 'src/index.ts': true },
              deleted: { 'old.ts': true },
            },
          },
        },
      ],
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

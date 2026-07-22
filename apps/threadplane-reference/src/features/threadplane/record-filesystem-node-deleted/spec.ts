import { createCommandSlice, event } from '@specter-ts/spec'

const recordFilesystemNodeDeletedSpec = createCommandSlice(
  'recordFilesystemNodeDeleted',
)
  .description(
    'Records deletion of a workspace filesystem node and its subtree.',
  )
  .scenarios(
    {
      description: 'Records deletion of a filesystem node by normalized path.',
      given: [
        event('filesystem-node-discovered', {
          scanId: 'scan-1',
          workspaceId: 'workspace-1',
          path: 'src/index.ts',
          parentPath: 'src',
          name: 'index.ts',
          kind: 'file',
          sizeBytes: 42,
        }),
      ],
      when: {
        scanId: 'scan-2',
        workspaceId: 'workspace-1',
        path: 'src/index.ts',
      },
      expect: [
        event('filesystem-node-deleted', {
          scanId: 'scan-2',
          workspaceId: 'workspace-1',
          path: 'src/index.ts',
        }),
      ],
    },
    {
      description: 'Rejects deleted node paths that escape the workspace.',
      given: [],
      when: {
        scanId: 'scan-1',
        workspaceId: 'workspace-1',
        path: '../secrets.txt',
      },
      expect: [],
      reject: {
        reason: 'Filesystem node path must be relative and normalized',
      },
    },
  )

export default recordFilesystemNodeDeletedSpec

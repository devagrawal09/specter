import { createCommandSlice, event } from '@specter-ts/spec'

const recordFilesystemNodeDiscoveredSpec = createCommandSlice(
  'recordFilesystemNodeDiscovered',
)
  .description('Records a discovered workspace filesystem node.')
  .scenarios(
    {
      description: 'Records metadata for a newly discovered filesystem node.',
      given: [],
      when: {
        scanId: 'scan-1',
        workspaceId: 'workspace-1',
        path: 'src/index.ts',
        parentPath: 'src',
        name: 'index.ts',
        kind: 'file',
        sizeBytes: 42,
        modifiedAt: '2026-06-13T12:00:00.000Z',
      },
      expect: [
        event('filesystem-node-discovered', {
          scanId: 'scan-1',
          workspaceId: 'workspace-1',
          path: 'src/index.ts',
          parentPath: 'src',
          name: 'index.ts',
          kind: 'file',
          sizeBytes: 42,
          modifiedAt: '2026-06-13T12:00:00.000Z',
        }),
      ],
    },
    {
      description: 'Rejects absolute filesystem node paths.',
      given: [],
      when: {
        scanId: 'scan-1',
        workspaceId: 'workspace-1',
        path: '/etc/passwd',
        parentPath: null,
        name: 'passwd',
        kind: 'file',
        sizeBytes: 42,
      },
      expect: [],
      reject: {
        reason: 'Filesystem node path must be relative and normalized',
      },
    },
  )

export default recordFilesystemNodeDiscoveredSpec

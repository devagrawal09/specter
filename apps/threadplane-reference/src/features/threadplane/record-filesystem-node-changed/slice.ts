import { createCommandSlice } from '@specter-ts/core'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import {
  filesystemNodeChangedEvent,
  filesystemNodeDiscoveredEvent,
} from '../events'

const recordFilesystemNodeChanged = createCommandSlice(
  'recordFilesystemNodeChanged',
  'Records updated metadata for a workspace filesystem node.',
)
  .schema(
    z.object({
      scanId: z.string(),
      workspaceId: z.string(),
      path: z.string(),
      parentPath: z.string().nullable(),
      name: z.string(),
      kind: z.enum(['file', 'directory']),
      sizeBytes: z.number().int().nonnegative().nullable(),
      modifiedAt: z.string().optional(),
    }),
  )
  .store(createMemorySliceStore(() => ({})))
  .scenarios(
    {
      description: 'Records changed metadata for an existing filesystem node.',
      given: [
        filesystemNodeDiscoveredEvent.create({
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
      when: {
        scanId: 'scan-2',
        workspaceId: 'workspace-1',
        path: 'src/index.ts',
        parentPath: 'src',
        name: 'index.ts',
        kind: 'file',
        sizeBytes: 84,
        modifiedAt: '2026-06-13T12:01:00.000Z',
      },
      expect: [
        filesystemNodeChangedEvent.create({
          scanId: 'scan-2',
          workspaceId: 'workspace-1',
          path: 'src/index.ts',
          parentPath: 'src',
          name: 'index.ts',
          kind: 'file',
          sizeBytes: 84,
          modifiedAt: '2026-06-13T12:01:00.000Z',
        }),
      ],
    },
    {
      description: 'Rejects parent paths that escape the workspace.',
      given: [],
      when: {
        scanId: 'scan-1',
        workspaceId: 'workspace-1',
        path: 'src/index.ts',
        parentPath: '../src',
        name: 'index.ts',
        kind: 'file',
        sizeBytes: 84,
      },
      expect: [],
      reject: {
        reason: 'Filesystem parent path must be relative and normalized',
      },
    },
  )
  .handle(async (command) => {
    if (
      command.path.startsWith('/') ||
      command.path.includes('..') ||
      command.path === ''
    ) {
      throw new Error('Filesystem node path must be relative and normalized')
    }
    if (
      command.parentPath !== null &&
      (command.parentPath.startsWith('/') ||
        command.parentPath.includes('..') ||
        command.parentPath === '')
    ) {
      throw new Error('Filesystem parent path must be relative and normalized')
    }
    return [filesystemNodeChangedEvent.create(command)]
  })

export default recordFilesystemNodeChanged

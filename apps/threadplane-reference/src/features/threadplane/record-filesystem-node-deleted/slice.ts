import { createCommandSlice } from '@specter-ts/core'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import {
  filesystemNodeDeletedEvent,
  filesystemNodeDiscoveredEvent,
} from '../events'

const recordFilesystemNodeDeleted = createCommandSlice(
  'recordFilesystemNodeDeleted',
  'Records deletion of a workspace filesystem node and its subtree.',
)
  .schema(
    z.object({
      scanId: z.string(),
      workspaceId: z.string(),
      path: z.string(),
    }),
  )
  .store(createMemorySliceStore(() => ({})))
  .scenarios(
    {
      description: 'Records deletion of a filesystem node by normalized path.',
      given: [
        filesystemNodeDiscoveredEvent.create({
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
        filesystemNodeDeletedEvent.create({
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
  .handle(async (command) => {
    if (
      command.path.startsWith('/') ||
      command.path.includes('..') ||
      command.path === ''
    ) {
      throw new Error('Filesystem node path must be relative and normalized')
    }
    return [filesystemNodeDeletedEvent.create(command)]
  })

export default recordFilesystemNodeDeleted

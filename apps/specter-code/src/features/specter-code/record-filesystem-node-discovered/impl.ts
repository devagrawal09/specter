import recordFilesystemNodeDiscoveredSpec from './spec'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import { filesystemNodeDiscoveredEvent } from '../events'

const recordFilesystemNodeDiscovered = recordFilesystemNodeDiscoveredSpec
  .inputSchema(z.object({
      scanId: z.string(),
      workspaceId: z.string(),
      path: z.string(),
      parentPath: z.string().nullable(),
      name: z.string(),
      kind: z.enum(['file', 'directory']),
      sizeBytes: z.number().int().nonnegative().nullable(),
      modifiedAt: z.string().optional(),
    }))
  .store(createMemorySliceStore(() => ({})))
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
    return [filesystemNodeDiscoveredEvent.create(command)]
  })

export default recordFilesystemNodeDiscovered

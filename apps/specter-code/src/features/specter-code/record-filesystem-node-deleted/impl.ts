import recordFilesystemNodeDeletedSpec from './spec'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import {
  filesystemNodeDeletedEvent,
  filesystemNodeDiscoveredEvent,
} from '../events'

const recordFilesystemNodeDeleted = recordFilesystemNodeDeletedSpec
  .inputSchema(z.object({
      scanId: z.string(),
      workspaceId: z.string(),
      path: z.string(),
    }))
  .store(createMemorySliceStore(() => ({})))
  .apply(filesystemNodeDiscoveredEvent, async () => {})
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

import recordWorkspaceFilesystemScanCompletedSpec from './spec'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import { workspaceFilesystemScanCompletedEvent } from '../events'

const recordWorkspaceFilesystemScanCompleted =
  recordWorkspaceFilesystemScanCompletedSpec
    .inputSchema(
      z.object({
        scanId: z.string(),
        workspaceId: z.string(),
        discoveredNodeCount: z.number().int().nonnegative(),
        changedNodeCount: z.number().int().nonnegative(),
        deletedNodeCount: z.number().int().nonnegative(),
      }),
    )
    .store(createMemorySliceStore(() => ({})))
    .handle(async (command) => {
      return [
        workspaceFilesystemScanCompletedEvent.create({
          scanId: command.scanId,
          workspaceId: command.workspaceId,
          discoveredNodeCount: command.discoveredNodeCount,
          changedNodeCount: command.changedNodeCount,
          deletedNodeCount: command.deletedNodeCount,
        }),
      ]
    })

export default recordWorkspaceFilesystemScanCompleted

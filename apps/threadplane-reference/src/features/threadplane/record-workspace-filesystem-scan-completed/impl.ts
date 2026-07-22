import specification from './spec.json' with { type: 'json' }
import { implementCommand } from '@specter-ts/core'
import { z } from 'zod'

import { defineMemorySliceStore } from '../../../testing/memory-slice-store'
import { workspaceFilesystemScanCompletedEvent } from '../events'

const recordWorkspaceFilesystemScanCompleted = implementCommand(specification)
  .inputSchema(
    z.object({
      scanId: z.string(),
      workspaceId: z.string(),
      discoveredNodeCount: z.number().int().nonnegative(),
      changedNodeCount: z.number().int().nonnegative(),
      deletedNodeCount: z.number().int().nonnegative(),
    }),
  )
  .store(defineMemorySliceStore(() => ({})))
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

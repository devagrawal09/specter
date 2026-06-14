import { createCommandSlice } from '@specter-ts/core'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import { workspaceFilesystemScanCompletedEvent } from '../events'

const recordWorkspaceFilesystemScanCompleted = createCommandSlice(
  'recordWorkspaceFilesystemScanCompleted',
  'Records that a workspace filesystem metadata scan completed.',
)
  .schema(
    z.object({
      scanId: z.string(),
      workspaceId: z.string(),
      discoveredNodeCount: z.number().int().nonnegative(),
      changedNodeCount: z.number().int().nonnegative(),
      deletedNodeCount: z.number().int().nonnegative(),
    }),
  )
  .store(createMemorySliceStore(() => ({})))
  .scenarios({
    description: 'Records filesystem scan completion with node totals.',
    given: [],
    when: {
      scanId: 'scan-1',
      workspaceId: 'workspace-1',
      discoveredNodeCount: 3,
      changedNodeCount: 1,
      deletedNodeCount: 1,
    },
    expect: [
      workspaceFilesystemScanCompletedEvent.create({
        scanId: 'scan-1',
        workspaceId: 'workspace-1',
        discoveredNodeCount: 3,
        changedNodeCount: 1,
        deletedNodeCount: 1,
      }),
    ],
  })
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

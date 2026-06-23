import { createCommandSlice } from '@specter-ts/core'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import { workspaceFilesystemScanFailedEvent } from '../events'

const recordWorkspaceFilesystemScanFailed = createCommandSlice(
  'recordWorkspaceFilesystemScanFailed',
  'Records that a workspace filesystem metadata scan failed.',
)
  .schema(
    z.object({
      scanId: z.string(),
      workspaceId: z.string(),
      error: z.string(),
    }),
  )
  .store(createMemorySliceStore(() => ({})))
  .scenarios({
    description: 'Records filesystem scan failure with its error message.',
    given: [],
    when: {
      scanId: 'scan-1',
      workspaceId: 'workspace-1',
      error: 'Workspace directory is unavailable',
    },
    expect: [
      workspaceFilesystemScanFailedEvent.create({
        scanId: 'scan-1',
        workspaceId: 'workspace-1',
        error: 'Workspace directory is unavailable',
      }),
    ],
  })
  .handle(async (command) => {
    return [
      workspaceFilesystemScanFailedEvent.create({
        scanId: command.scanId,
        workspaceId: command.workspaceId,
        error: command.error,
      }),
    ]
  })

export default recordWorkspaceFilesystemScanFailed

import specification from './spec.json' with { type: 'json' }
import { implementCommand } from '@specter-ts/core'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import { workspaceFilesystemScanFailedEvent } from '../events'

const recordWorkspaceFilesystemScanFailed =
  implementCommand<'recordWorkspaceFilesystemScanFailed'>(specification)
    .inputSchema(
      z.object({
        scanId: z.string(),
        workspaceId: z.string(),
        error: z.string(),
      }),
    )
    .store(createMemorySliceStore(() => ({})))
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

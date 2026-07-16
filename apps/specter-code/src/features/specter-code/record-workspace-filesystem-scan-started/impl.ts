import recordWorkspaceFilesystemScanStartedSpec from './spec'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import {
  workspaceFilesystemScanRequestedEvent,
  workspaceFilesystemScanStartedEvent,
} from '../events'

const recordWorkspaceFilesystemScanStarted =
  recordWorkspaceFilesystemScanStartedSpec
    .inputSchema(
      z.object({
        scanId: z.string(),
        workspaceId: z.string(),
      }),
    )
    .store(createMemorySliceStore(() => ({})))
    .apply(workspaceFilesystemScanRequestedEvent, async () => {})
    .handle(async (command) => {
      return [
        workspaceFilesystemScanStartedEvent.create({
          scanId: command.scanId,
          workspaceId: command.workspaceId,
        }),
      ]
    })

export default recordWorkspaceFilesystemScanStarted

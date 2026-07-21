import recordWorkspaceFilesystemScanStartedSpec from './spec'
import { z } from 'zod'

import { defineMemorySliceStore } from '../../../testing/memory-slice-store'
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
        snapshot: z
          .array(
            z.object({
              path: z.string(),
              parentPath: z.string().nullable(),
              name: z.string(),
              kind: z.enum(['file', 'directory']),
              sizeBytes: z.number().int().nonnegative().nullable(),
              modifiedAt: z.string().optional(),
            }),
          )
          .optional(),
      }),
    )
    .store(defineMemorySliceStore(() => ({})))
    .apply(workspaceFilesystemScanRequestedEvent, async () => {})
    .handle(async (command) => {
      return [
        workspaceFilesystemScanStartedEvent.create({
          scanId: command.scanId,
          workspaceId: command.workspaceId,
          ...(command.snapshot ? { snapshot: command.snapshot } : {}),
        }),
      ]
    })

export default recordWorkspaceFilesystemScanStarted

import specification from './spec.json' with { type: 'json' }
import { implementCommand } from '@specter-ts/core'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import {
  workspaceFilesystemScanRequestedEvent,
  workspaceFilesystemScanStartedEvent,
} from '../events'

const recordWorkspaceFilesystemScanStarted =
  implementCommand<'recordWorkspaceFilesystemScanStarted'>(specification)
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
    .store(createMemorySliceStore(() => ({})))
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

import requestWorkspaceFilesystemScanSpec from './spec'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import { workspaceFilesystemScanRequestedEvent } from '../events'

const requestWorkspaceFilesystemScan = requestWorkspaceFilesystemScanSpec
  .inputSchema(z.object({
      scanId: z.string(),
      workspaceId: z.string(),
      reason: z.enum(['workspaceCreated', 'userRequested', 'agentToolChanged']),
      requestedBy: z.discriminatedUnion('type', [
        z.object({
          type: z.literal('user'),
          userId: z.string().optional(),
          displayName: z.string(),
        }),
        z.object({
          type: z.literal('agent'),
          agentId: z.string(),
          displayName: z.string(),
        }),
        z.object({
          type: z.literal('system'),
        }),
      ]),
    }))
  .store(createMemorySliceStore(() => ({})))
  .handle(async (command) => {
    return [
      workspaceFilesystemScanRequestedEvent.create({
        scanId: command.scanId,
        workspaceId: command.workspaceId,
        reason: command.reason,
        requestedBy: command.requestedBy,
      }),
    ]
  })

export default requestWorkspaceFilesystemScan

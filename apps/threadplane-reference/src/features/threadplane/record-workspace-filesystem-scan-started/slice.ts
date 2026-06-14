import { createCommandSlice } from '@specter-ts/core'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import {
  workspaceFilesystemScanRequestedEvent,
  workspaceFilesystemScanStartedEvent,
} from '../events'

const recordWorkspaceFilesystemScanStarted = createCommandSlice(
  'recordWorkspaceFilesystemScanStarted',
  'Records that a workspace filesystem metadata scan started.',
)
  .schema(
    z.object({
      scanId: z.string(),
      workspaceId: z.string(),
    }),
  )
  .store(createMemorySliceStore(() => ({})))
  .scenarios({
    description: 'Records the start of a requested filesystem scan.',
    given: [
      workspaceFilesystemScanRequestedEvent.create({
        scanId: 'scan-1',
        workspaceId: 'workspace-1',
        reason: 'userRequested',
        requestedBy: { type: 'user', displayName: 'Ada' },
      }),
    ],
    when: {
      scanId: 'scan-1',
      workspaceId: 'workspace-1',
    },
    expect: [
      workspaceFilesystemScanStartedEvent.create({
        scanId: 'scan-1',
        workspaceId: 'workspace-1',
      }),
    ],
  })
  .handle(async () => {
    throw new Error('TODO: implement recordWorkspaceFilesystemScanStarted')
  })

export default recordWorkspaceFilesystemScanStarted

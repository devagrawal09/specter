import { createReactionSlice } from '@specter-ts/core'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import {
  workspaceFilesystemScanCompletedEvent,
  workspaceFilesystemScanFailedEvent,
  workspaceFilesystemScanRequestedEvent,
  workspaceFilesystemScanStartedEvent,
} from '../events'

type FilesystemScanJob = {
  scanId: string
  workspaceId: string
}

type RunRequestedFilesystemScanState = {
  requestedScans: FilesystemScanJob[]
  startedScanIds: Set<string>
  terminalScanIds: Set<string>
}

const runRequestedFilesystemScan = createReactionSlice(
  'runRequestedFilesystemScan',
  'Executes requested workspace filesystem scans through the scan runner.',
)
  .payload<FilesystemScanJob>()
  .plugin(async () => async () => {
    throw new Error('TODO: wire filesystem scan runner')
  })
  .store(
    createMemorySliceStore<RunRequestedFilesystemScanState>(() => ({
      requestedScans: [],
      startedScanIds: new Set(),
      terminalScanIds: new Set(),
    })),
  )
  .scenarios(
    {
      description: 'Queues a requested filesystem scan that has not started.',
      given: [
        workspaceFilesystemScanRequestedEvent.create({
          scanId: 'scan-1',
          workspaceId: 'workspace-1',
          reason: 'userRequested',
          requestedBy: { type: 'user', displayName: 'Ada' },
        }),
      ],
      expect: [{ scanId: 'scan-1', workspaceId: 'workspace-1' }],
    },
    {
      description: 'Does not queue a filesystem scan that already started.',
      given: [
        workspaceFilesystemScanRequestedEvent.create({
          scanId: 'scan-1',
          workspaceId: 'workspace-1',
          reason: 'workspaceCreated',
          requestedBy: { type: 'system' },
        }),
        workspaceFilesystemScanStartedEvent.create({
          scanId: 'scan-1',
          workspaceId: 'workspace-1',
        }),
      ],
      expect: [],
    },
    {
      description:
        'Does not queue a filesystem scan that already completed or failed.',
      given: [
        workspaceFilesystemScanRequestedEvent.create({
          scanId: 'scan-1',
          workspaceId: 'workspace-1',
          reason: 'workspaceCreated',
          requestedBy: { type: 'system' },
        }),
        workspaceFilesystemScanCompletedEvent.create({
          scanId: 'scan-1',
          workspaceId: 'workspace-1',
          discoveredNodeCount: 2,
          changedNodeCount: 0,
          deletedNodeCount: 0,
        }),
        workspaceFilesystemScanRequestedEvent.create({
          scanId: 'scan-2',
          workspaceId: 'workspace-1',
          reason: 'userRequested',
          requestedBy: { type: 'user', displayName: 'Ada' },
        }),
        workspaceFilesystemScanFailedEvent.create({
          scanId: 'scan-2',
          workspaceId: 'workspace-1',
          error: 'Workspace directory is unavailable',
        }),
      ],
      expect: [],
    },
  )
  .handle(async (): Promise<FilesystemScanJob | undefined> => {
    throw new Error('TODO: implement runRequestedFilesystemScan')
  })

export default runRequestedFilesystemScan

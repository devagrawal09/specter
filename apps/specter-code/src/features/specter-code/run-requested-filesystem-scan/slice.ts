import { createReactionSlice } from '@specter-ts/core'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import {
  workspaceFilesystemScanCompletedEvent,
  workspaceFilesystemScanFailedEvent,
  workspaceFilesystemScanRequestedEvent,
  workspaceFilesystemScanStartedEvent,
} from '../events'
import { scanWorkspaceFilesystem } from '../filesystem-metadata-adapter'

type FilesystemScanJob = {
  scanId: string
  workspaceId: string
}

type RunRequestedFilesystemScanState = {
  requestedScans: FilesystemScanJob[]
  startedScanIds: Set<string>
  terminalScanIds: Set<string>
}

const lastSnapshotsByWorkspace = new Map<string, Map<string, string>>()

const runRequestedFilesystemScan = createReactionSlice(
  'runRequestedFilesystemScan',
  'Executes requested workspace filesystem scans through the scan runner.',
)
  .payload<FilesystemScanJob>()
  .plugin(async (command) => async (job) => {
    const scanJob = job as FilesystemScanJob
    const previous =
      lastSnapshotsByWorkspace.get(scanJob.workspaceId) ??
      new Map<string, string>()

    try {
      const current = await scanWorkspaceFilesystem(scanJob.workspaceId)
      const next = new Map(
        current.map((node) => [node.path, JSON.stringify(node)]),
      )
      const discovered = current.filter((node) => !previous.has(node.path))
      const changed = current.filter(
        (node) =>
          previous.has(node.path) &&
          previous.get(node.path) !== JSON.stringify(node),
      )
      const deleted = [...previous.keys()].filter(
        (nodePath) => !next.has(nodePath),
      )

      lastSnapshotsByWorkspace.set(scanJob.workspaceId, next)

      await command({
        type: 'recordWorkspaceFilesystemScanStarted',
        payload: {
          workspaceId: scanJob.workspaceId,
          scanId: scanJob.scanId,
        },
      } as never)
      for (const node of discovered) {
        await command({
          type: 'recordFilesystemNodeDiscovered',
          payload: {
            scanId: scanJob.scanId,
            workspaceId: scanJob.workspaceId,
            ...node,
          },
        } as never)
      }
      for (const node of changed) {
        await command({
          type: 'recordFilesystemNodeChanged',
          payload: {
            scanId: scanJob.scanId,
            workspaceId: scanJob.workspaceId,
            ...node,
          },
        } as never)
      }
      for (const path of deleted) {
        await command({
          type: 'recordFilesystemNodeDeleted',
          payload: {
            scanId: scanJob.scanId,
            workspaceId: scanJob.workspaceId,
            path,
          },
        } as never)
      }
      return command({
        type: 'recordWorkspaceFilesystemScanCompleted',
        payload: {
          scanId: scanJob.scanId,
          workspaceId: scanJob.workspaceId,
          discoveredNodeCount: discovered.length,
          changedNodeCount: changed.length,
          deletedNodeCount: deleted.length,
        },
      } as never)
    } catch (error) {
      await command({
        type: 'recordWorkspaceFilesystemScanStarted',
        payload: { scanId: scanJob.scanId, workspaceId: scanJob.workspaceId },
      } as never)
      return command({
        type: 'recordWorkspaceFilesystemScanFailed',
        payload: {
          scanId: scanJob.scanId,
          workspaceId: scanJob.workspaceId,
          error: error instanceof Error ? error.message : String(error),
        },
      } as never)
    }
  })
  .store(
    createMemorySliceStore<RunRequestedFilesystemScanState>(() => ({
      requestedScans: [],
      startedScanIds: new Set(),
      terminalScanIds: new Set(),
    })),
  )
  .apply({
    [workspaceFilesystemScanRequestedEvent.type]: async (event, state) => {
      const payload = await workspaceFilesystemScanRequestedEvent.decode(
        event.payload,
      )
      state.requestedScans.push({
        scanId: payload.scanId,
        workspaceId: payload.workspaceId,
      })
    },
    [workspaceFilesystemScanStartedEvent.type]: async (event, state) => {
      const payload = await workspaceFilesystemScanStartedEvent.decode(
        event.payload,
      )
      state.startedScanIds.add(payload.scanId)
    },
    [workspaceFilesystemScanCompletedEvent.type]: async (event, state) => {
      const payload = await workspaceFilesystemScanCompletedEvent.decode(
        event.payload,
      )
      state.terminalScanIds.add(payload.scanId)
    },
    [workspaceFilesystemScanFailedEvent.type]: async (event, state) => {
      const payload = await workspaceFilesystemScanFailedEvent.decode(
        event.payload,
      )
      state.terminalScanIds.add(payload.scanId)
    },
  })
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
  .handle(async (state): Promise<FilesystemScanJob | undefined> => {
    const job = state.requestedScans.find(
      (scan) =>
        !state.startedScanIds.has(scan.scanId) &&
        !state.terminalScanIds.has(scan.scanId),
    )
    if (!job) return undefined
    return job
  })

export default runRequestedFilesystemScan

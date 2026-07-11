import runRequestedFilesystemScanSpec from './spec'

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

type RunWorkspaceFilesystemScanCommand = {
  type: 'runWorkspaceFilesystemScan'
  payload: FilesystemScanJob
}

type RunRequestedFilesystemScanState = {
  requestedScans: FilesystemScanJob[]
  startedScanIds: Set<string>
  terminalScanIds: Set<string>
}

const lastSnapshotsByWorkspace = new Map<string, Map<string, string>>()

const runRequestedFilesystemScan = runRequestedFilesystemScanSpec
  .outputSchema<RunWorkspaceFilesystemScanCommand>()
  .plugin(async (command) => async (job) => {
    const scanJob = job.payload
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
  .store(createMemorySliceStore<RunRequestedFilesystemScanState>(() => ({
      requestedScans: [],
      startedScanIds: new Set(),
      terminalScanIds: new Set(),
    })))
  .apply(workspaceFilesystemScanRequestedEvent, async (event, state) => {
      const payload = event.payload
      state.requestedScans.push({
        scanId: payload.scanId,
        workspaceId: payload.workspaceId,
      })
    })
  .apply(workspaceFilesystemScanStartedEvent, async (event, state) => {
      const payload = event.payload
      state.startedScanIds.add(payload.scanId)
    })
  .apply(workspaceFilesystemScanCompletedEvent, async (event, state) => {
      const payload = event.payload
      state.terminalScanIds.add(payload.scanId)
    })
  .apply(workspaceFilesystemScanFailedEvent, async (event, state) => {
      const payload = event.payload
      state.terminalScanIds.add(payload.scanId)
    })
  .handle(async (state): Promise<RunWorkspaceFilesystemScanCommand | undefined> => {
    const job = state.requestedScans.find(
      (scan) =>
        !state.startedScanIds.has(scan.scanId) &&
        !state.terminalScanIds.has(scan.scanId),
    )
    if (!job) return undefined
    return { type: 'runWorkspaceFilesystemScan', payload: job }
  })

export default runRequestedFilesystemScan

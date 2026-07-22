import runRequestedFilesystemScanSpec from './spec'
import { Effect } from 'effect'

import { defineMemorySliceStore } from '../../../testing/memory-slice-store'
import {
  filesystemNodeChangedEvent,
  filesystemNodeDeletedEvent,
  filesystemNodeDiscoveredEvent,
  workspaceFilesystemScanCompletedEvent,
  workspaceFilesystemScanFailedEvent,
  workspaceFilesystemScanRequestedEvent,
  workspaceFilesystemScanStartedEvent,
} from '../events'
import {
  scanWorkspaceFilesystem,
  type FilesystemNodeSnapshot,
} from '../filesystem-metadata-adapter'

type FilesystemScanJob = {
  scanId: string
  workspaceId: string
}

type FilesystemScanProgress = {
  discovered: Record<string, true>
  changed: Record<string, true>
  deleted: Record<string, true>
}

type RunWorkspaceFilesystemScanCommand = {
  type: 'runWorkspaceFilesystemScan'
  payload: FilesystemScanJob & {
    baseline: FilesystemNodeSnapshot[]
    plannedSnapshot: FilesystemNodeSnapshot[] | null
    progress: FilesystemScanProgress
  }
}

type RunRequestedFilesystemScanState = {
  requestedScans: FilesystemScanJob[]
  plannedSnapshots: Record<string, FilesystemNodeSnapshot[]>
  terminalScanIds: Set<string>
  nodesByWorkspace: Record<string, Record<string, FilesystemNodeSnapshot>>
  progressByScan: Record<string, FilesystemScanProgress>
}

const emptyProgress = (): FilesystemScanProgress => ({
  discovered: {},
  changed: {},
  deleted: {},
})

const workspaceNodes = (
  state: RunRequestedFilesystemScanState,
  workspaceId: string,
) => (state.nodesByWorkspace[workspaceId] ??= {})

const scanProgress = (state: RunRequestedFilesystemScanState, scanId: string) =>
  (state.progressByScan[scanId] ??= emptyProgress())

const snapshotKey = (node: FilesystemNodeSnapshot) => JSON.stringify(node)

const runRequestedFilesystemScan = runRequestedFilesystemScanSpec
  .outputSchema<RunWorkspaceFilesystemScanCommand>()
  .plugin((command) =>
    Effect.succeed((job, context) =>
      Effect.gen(function* () {
        const dispatch = (
          suffix: string,
          envelope: { type: string; payload: unknown },
        ) =>
          command(envelope, {
            idempotencyKey: `${context.deliveryId}:${suffix}`,
          })
        const scanJob = job.payload
        let plannedSnapshot = scanJob.plannedSnapshot

        if (!plannedSnapshot) {
          plannedSnapshot = yield* Effect.tryPromise(() =>
            scanWorkspaceFilesystem(scanJob.workspaceId),
          ).pipe(
            Effect.catch((error) =>
              dispatch('failed', {
                type: 'recordWorkspaceFilesystemScanFailed',
                payload: {
                  scanId: scanJob.scanId,
                  workspaceId: scanJob.workspaceId,
                  error: error instanceof Error ? error.message : String(error),
                },
              }).pipe(Effect.as(null)),
            ),
          )
          if (!plannedSnapshot) return

          yield* dispatch('started', {
            type: 'recordWorkspaceFilesystemScanStarted',
            payload: {
              workspaceId: scanJob.workspaceId,
              scanId: scanJob.scanId,
              snapshot: plannedSnapshot,
            },
          })
        }

        const previous = new Map(
          scanJob.baseline.map((node) => [node.path, snapshotKey(node)]),
        )
        const next = new Map(
          plannedSnapshot.map((node) => [node.path, snapshotKey(node)]),
        )
        const discovered = plannedSnapshot.filter(
          (node) => !previous.has(node.path),
        )
        const changed = plannedSnapshot.filter(
          (node) =>
            previous.has(node.path) &&
            previous.get(node.path) !== snapshotKey(node),
        )
        const deleted = [...previous.keys()].filter(
          (nodePath) => !next.has(nodePath),
        )

        for (const node of discovered) {
          yield* dispatch(`discovered:${node.path}`, {
            type: 'recordFilesystemNodeDiscovered',
            payload: {
              scanId: scanJob.scanId,
              workspaceId: scanJob.workspaceId,
              ...node,
            },
          })
        }
        for (const node of changed) {
          yield* dispatch(`changed:${node.path}`, {
            type: 'recordFilesystemNodeChanged',
            payload: {
              scanId: scanJob.scanId,
              workspaceId: scanJob.workspaceId,
              ...node,
            },
          })
        }
        for (const path of deleted) {
          yield* dispatch(`deleted:${path}`, {
            type: 'recordFilesystemNodeDeleted',
            payload: {
              scanId: scanJob.scanId,
              workspaceId: scanJob.workspaceId,
              path,
            },
          })
        }

        yield* dispatch('completed', {
          type: 'recordWorkspaceFilesystemScanCompleted',
          payload: {
            scanId: scanJob.scanId,
            workspaceId: scanJob.workspaceId,
            discoveredNodeCount:
              Object.keys(scanJob.progress.discovered).length +
              discovered.length,
            changedNodeCount:
              Object.keys(scanJob.progress.changed).length + changed.length,
            deletedNodeCount:
              Object.keys(scanJob.progress.deleted).length + deleted.length,
          },
        })
      }),
    ),
  )
  .store(
    defineMemorySliceStore<RunRequestedFilesystemScanState>(() => ({
      requestedScans: [],
      plannedSnapshots: {},
      terminalScanIds: new Set(),
      nodesByWorkspace: {},
      progressByScan: {},
    })),
  )
  .apply(workspaceFilesystemScanRequestedEvent, async (event, state) => {
    const payload = event.payload
    if (!state.requestedScans.some((scan) => scan.scanId === payload.scanId)) {
      state.requestedScans.push({
        scanId: payload.scanId,
        workspaceId: payload.workspaceId,
      })
    }
  })
  .apply(workspaceFilesystemScanStartedEvent, async (event, state) => {
    const payload = event.payload
    if (payload.snapshot)
      state.plannedSnapshots[payload.scanId] = payload.snapshot
  })
  .apply(filesystemNodeDiscoveredEvent, async (event, state) => {
    const payload = event.payload
    workspaceNodes(state, payload.workspaceId)[payload.path] = {
      path: payload.path,
      parentPath: payload.parentPath,
      name: payload.name,
      kind: payload.kind,
      sizeBytes: payload.sizeBytes,
      ...(payload.modifiedAt ? { modifiedAt: payload.modifiedAt } : {}),
    }
    scanProgress(state, payload.scanId).discovered[payload.path] = true
  })
  .apply(filesystemNodeChangedEvent, async (event, state) => {
    const payload = event.payload
    workspaceNodes(state, payload.workspaceId)[payload.path] = {
      path: payload.path,
      parentPath: payload.parentPath,
      name: payload.name,
      kind: payload.kind,
      sizeBytes: payload.sizeBytes,
      ...(payload.modifiedAt ? { modifiedAt: payload.modifiedAt } : {}),
    }
    scanProgress(state, payload.scanId).changed[payload.path] = true
  })
  .apply(filesystemNodeDeletedEvent, async (event, state) => {
    const payload = event.payload
    const nodes = workspaceNodes(state, payload.workspaceId)
    for (const path of Object.keys(nodes)) {
      if (path === payload.path || path.startsWith(`${payload.path}/`)) {
        delete nodes[path]
      }
    }
    scanProgress(state, payload.scanId).deleted[payload.path] = true
  })
  .apply(workspaceFilesystemScanCompletedEvent, async (event, state) => {
    state.terminalScanIds.add(event.payload.scanId)
  })
  .apply(workspaceFilesystemScanFailedEvent, async (event, state) => {
    state.terminalScanIds.add(event.payload.scanId)
  })
  .handle(
    async (state): Promise<RunWorkspaceFilesystemScanCommand | undefined> => {
      const job = state.requestedScans.find(
        (scan) => !state.terminalScanIds.has(scan.scanId),
      )
      if (!job) return undefined

      return {
        type: 'runWorkspaceFilesystemScan',
        payload: {
          ...job,
          baseline: Object.values(
            state.nodesByWorkspace[job.workspaceId] ?? {},
          ),
          plannedSnapshot: state.plannedSnapshots[job.scanId] ?? null,
          progress: state.progressByScan[job.scanId] ?? emptyProgress(),
        },
      }
    },
  )

export default runRequestedFilesystemScan

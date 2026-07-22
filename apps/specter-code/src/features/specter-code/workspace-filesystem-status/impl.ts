import specification from './spec.json' with { type: 'json' }
import { implementQuery } from '@specter-ts/core'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import {
  workspaceFilesystemInitializedEvent,
  workspaceFilesystemScanCompletedEvent,
  workspaceFilesystemScanFailedEvent,
  workspaceFilesystemScanRequestedEvent,
  workspaceFilesystemScanStartedEvent,
} from '../events'

type WorkspaceFilesystemScanStatus =
  | {
      scanId: string
      status: 'requested' | 'running'
      reason: 'workspaceCreated' | 'userRequested' | 'agentToolChanged'
      requestedBy:
        | { type: 'user'; userId?: string; displayName: string }
        | { type: 'agent'; agentId: string; displayName: string }
        | { type: 'system' }
    }
  | {
      scanId: string
      status: 'completed'
      reason: 'workspaceCreated' | 'userRequested' | 'agentToolChanged'
      requestedBy:
        | { type: 'user'; userId?: string; displayName: string }
        | { type: 'agent'; agentId: string; displayName: string }
        | { type: 'system' }
      discoveredNodeCount: number
      changedNodeCount: number
      deletedNodeCount: number
    }
  | {
      scanId: string
      status: 'failed'
      reason: 'workspaceCreated' | 'userRequested' | 'agentToolChanged'
      requestedBy:
        | { type: 'user'; userId?: string; displayName: string }
        | { type: 'agent'; agentId: string; displayName: string }
        | { type: 'system' }
      error: string
    }

type WorkspaceFilesystemStatus = {
  initialized: boolean
  latestScan: WorkspaceFilesystemScanStatus | null
}

type WorkspaceFilesystemStatusState = {
  statuses: Record<string, WorkspaceFilesystemStatus>
}

const getStatus = (
  state: WorkspaceFilesystemStatusState,
  workspaceId: string,
): WorkspaceFilesystemStatus => {
  const existing = state.statuses[workspaceId]
  if (existing) return existing

  const status = { initialized: false, latestScan: null }
  state.statuses[workspaceId] = status
  return status
}

const workspaceFilesystemStatus = implementQuery<'workspaceFilesystemStatus'>(
  specification,
)
  .inputSchema(
    z.object({
      workspaceId: z.string(),
    }),
  )
  .outputSchema<WorkspaceFilesystemStatus>()
  .store(
    createMemorySliceStore<WorkspaceFilesystemStatusState>(() => ({
      statuses: {},
    })),
  )
  .apply(workspaceFilesystemInitializedEvent, async (event, state) => {
    const payload = event.payload
    const current = getStatus(state, payload.workspaceId)
    current.initialized = true
  })
  .apply(workspaceFilesystemScanRequestedEvent, async (event, state) => {
    const payload = event.payload
    const current = getStatus(state, payload.workspaceId)
    current.latestScan = {
      scanId: payload.scanId,
      status: 'requested',
      reason: payload.reason,
      requestedBy: payload.requestedBy,
    }
  })
  .apply(workspaceFilesystemScanStartedEvent, async (event, state) => {
    const payload = event.payload
    const current = state.statuses[payload.workspaceId]
    if (current?.latestScan?.scanId === payload.scanId) {
      current.latestScan = { ...current.latestScan, status: 'running' }
    }
  })
  .apply(workspaceFilesystemScanCompletedEvent, async (event, state) => {
    const payload = event.payload
    const current = state.statuses[payload.workspaceId]
    if (current?.latestScan?.scanId === payload.scanId) {
      current.latestScan = {
        ...current.latestScan,
        status: 'completed',
        discoveredNodeCount: payload.discoveredNodeCount,
        changedNodeCount: payload.changedNodeCount,
        deletedNodeCount: payload.deletedNodeCount,
      }
    }
  })
  .apply(workspaceFilesystemScanFailedEvent, async (event, state) => {
    const payload = event.payload
    const current = state.statuses[payload.workspaceId]
    if (current?.latestScan?.scanId === payload.scanId) {
      current.latestScan = {
        ...current.latestScan,
        status: 'failed',
        error: payload.error,
      }
    }
  })
  .handle(async (query, state): Promise<WorkspaceFilesystemStatus> => {
    return (
      state.statuses[query.workspaceId] ?? {
        initialized: false,
        latestScan: null,
      }
    )
  })

export default workspaceFilesystemStatus

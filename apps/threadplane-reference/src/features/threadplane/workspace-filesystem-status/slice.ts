import { createQuerySlice } from '@specter-ts/core'
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

const workspaceFilesystemStatus = createQuerySlice(
  'workspaceFilesystemStatus',
  'Shows filesystem initialization and latest scan status for a workspace.',
)
  .schema(
    z.object({
      workspaceId: z.string(),
    }),
  )
  .store(
    createMemorySliceStore<WorkspaceFilesystemStatusState>(() => ({
      statuses: {},
    })),
  )
  .apply({
    [workspaceFilesystemInitializedEvent.type]: async (event, state) => {
      const payload = await workspaceFilesystemInitializedEvent.decode(
        event.payload,
      )
      const current = getStatus(state, payload.workspaceId)
      current.initialized = true
    },
    [workspaceFilesystemScanRequestedEvent.type]: async (event, state) => {
      const payload = await workspaceFilesystemScanRequestedEvent.decode(
        event.payload,
      )
      const current = getStatus(state, payload.workspaceId)
      current.latestScan = {
        scanId: payload.scanId,
        status: 'requested',
        reason: payload.reason,
        requestedBy: payload.requestedBy,
      }
    },
    [workspaceFilesystemScanStartedEvent.type]: async (event, state) => {
      const payload = await workspaceFilesystemScanStartedEvent.decode(
        event.payload,
      )
      const current = state.statuses[payload.workspaceId]
      if (current?.latestScan?.scanId === payload.scanId) {
        current.latestScan = { ...current.latestScan, status: 'running' }
      }
    },
    [workspaceFilesystemScanCompletedEvent.type]: async (event, state) => {
      const payload = await workspaceFilesystemScanCompletedEvent.decode(
        event.payload,
      )
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
    },
    [workspaceFilesystemScanFailedEvent.type]: async (event, state) => {
      const payload = await workspaceFilesystemScanFailedEvent.decode(
        event.payload,
      )
      const current = state.statuses[payload.workspaceId]
      if (current?.latestScan?.scanId === payload.scanId) {
        current.latestScan = {
          ...current.latestScan,
          status: 'failed',
          error: payload.error,
        }
      }
    },
  })
  .scenarios(
    {
      description: 'Reports a workspace with no initialized filesystem state.',
      given: [],
      when: { workspaceId: 'workspace-1' },
      expect: { initialized: false, latestScan: null },
    },
    {
      description: 'Reports a requested workspace filesystem scan.',
      given: [
        workspaceFilesystemInitializedEvent.create({
          workspaceId: 'workspace-1',
        }),
        workspaceFilesystemScanRequestedEvent.create({
          scanId: 'scan-1',
          workspaceId: 'workspace-1',
          reason: 'userRequested',
          requestedBy: { type: 'user', userId: 'user-1', displayName: 'Ada' },
        }),
      ],
      when: { workspaceId: 'workspace-1' },
      expect: {
        initialized: true,
        latestScan: {
          scanId: 'scan-1',
          status: 'requested',
          reason: 'userRequested',
          requestedBy: { type: 'user', userId: 'user-1', displayName: 'Ada' },
        },
      },
    },
    {
      description: 'Reports a running workspace filesystem scan.',
      given: [
        workspaceFilesystemInitializedEvent.create({
          workspaceId: 'workspace-1',
        }),
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
      when: { workspaceId: 'workspace-1' },
      expect: {
        initialized: true,
        latestScan: {
          scanId: 'scan-1',
          status: 'running',
          reason: 'workspaceCreated',
          requestedBy: { type: 'system' },
        },
      },
    },
    {
      description: 'Reports a completed workspace filesystem scan.',
      given: [
        workspaceFilesystemInitializedEvent.create({
          workspaceId: 'workspace-1',
        }),
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
        workspaceFilesystemScanCompletedEvent.create({
          scanId: 'scan-1',
          workspaceId: 'workspace-1',
          discoveredNodeCount: 3,
          changedNodeCount: 1,
          deletedNodeCount: 0,
        }),
      ],
      when: { workspaceId: 'workspace-1' },
      expect: {
        initialized: true,
        latestScan: {
          scanId: 'scan-1',
          status: 'completed',
          reason: 'workspaceCreated',
          requestedBy: { type: 'system' },
          discoveredNodeCount: 3,
          changedNodeCount: 1,
          deletedNodeCount: 0,
        },
      },
    },
    {
      description: 'Reports a failed workspace filesystem scan.',
      given: [
        workspaceFilesystemInitializedEvent.create({
          workspaceId: 'workspace-1',
        }),
        workspaceFilesystemScanRequestedEvent.create({
          scanId: 'scan-2',
          workspaceId: 'workspace-1',
          reason: 'userRequested',
          requestedBy: { type: 'user', userId: 'user-1', displayName: 'Ada' },
        }),
        workspaceFilesystemScanFailedEvent.create({
          scanId: 'scan-2',
          workspaceId: 'workspace-1',
          error: 'Workspace directory is unavailable',
        }),
      ],
      when: { workspaceId: 'workspace-1' },
      expect: {
        initialized: true,
        latestScan: {
          scanId: 'scan-2',
          status: 'failed',
          reason: 'userRequested',
          requestedBy: { type: 'user', userId: 'user-1', displayName: 'Ada' },
          error: 'Workspace directory is unavailable',
        },
      },
    },
  )
  .handle(async (query, state): Promise<WorkspaceFilesystemStatus> => {
    return (
      state.statuses[query.workspaceId] ?? {
        initialized: false,
        latestScan: null,
      }
    )
  })

export default workspaceFilesystemStatus

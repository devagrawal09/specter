import pendingPermissionsSpec from './spec'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import { toolApprovalRepliedEvent, toolApprovalRequestedEvent } from '../events'

type PendingPermission = {
  requestId: string
  sessionId: string
  messageId: string
  workspaceId: string
  agentId: string
  toolCallId?: string
  toolName: string
  permission: string
  target: string
  reason?: string
}

type PendingPermissionsState = {
  pending: Record<string, PendingPermission>
}

const pendingPermissions = pendingPermissionsSpec
  .inputSchema(
    z.object({
      sessionId: z.string(),
    }),
  )
  .outputSchema<PendingPermission[]>()
  .store(createMemorySliceStore<PendingPermissionsState>(() => ({ pending: {} })))
  .apply(toolApprovalRequestedEvent, async (event, state) => {
      const payload = event.payload
      state.pending[payload.requestId] = {
        requestId: payload.requestId,
        sessionId: payload.sessionId,
        messageId: payload.messageId,
        workspaceId: payload.workspaceId,
        agentId: payload.agentId,
        toolCallId: payload.toolCallId,
        toolName: payload.toolName,
        permission: payload.permission,
        target: payload.target,
        reason: payload.reason,
      }
    })
  .apply(toolApprovalRepliedEvent, async (event, state) => {
      const payload = event.payload
      delete state.pending[payload.requestId]
    })
  
  .handle(async (query, state): Promise<PendingPermission[]> => {
    return Object.values(state.pending).filter(
      (request) => request.sessionId === query.sessionId,
    )
  })

export default pendingPermissions

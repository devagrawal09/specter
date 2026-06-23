import { createQuerySlice } from '@specter-ts/core'
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

const pendingPermissions = createQuerySlice(
  'pendingPermissions',
  'Lists unresolved tool approval requests for a session.',
)
  .schema(
    z.object({
      sessionId: z.string(),
    }),
  )
  .store(createMemorySliceStore<PendingPermissionsState>(() => ({ pending: {} })))
  .apply({
    [toolApprovalRequestedEvent.type]: async (event, state) => {
      const payload = await toolApprovalRequestedEvent.decode(event.payload)
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
    },
    [toolApprovalRepliedEvent.type]: async (event, state) => {
      const payload = await toolApprovalRepliedEvent.decode(event.payload)
      delete state.pending[payload.requestId]
    },
  })
  .scenarios({
    description: 'Lists only unresolved tool approval requests for the queried session.',
    given: [
      toolApprovalRequestedEvent.create({
        requestId: 'permission-request-1',
        sessionId: 'session-1',
        messageId: 'message-1',
        workspaceId: 'workspace-1',
        agentId: 'build',
        toolCallId: 'tool-call-1',
        toolName: 'shell',
        permission: 'shell.execute',
        target: 'pnpm test',
        reason: 'Shell command requires confirmation',
      }),
      toolApprovalRequestedEvent.create({
        requestId: 'permission-request-2',
        sessionId: 'session-1',
        messageId: 'message-2',
        workspaceId: 'workspace-1',
        agentId: 'build',
        toolCallId: 'tool-call-2',
        toolName: 'write',
        permission: 'file.write',
        target: 'src/index.ts',
      }),
      toolApprovalRequestedEvent.create({
        requestId: 'permission-request-other-session',
        sessionId: 'session-2',
        messageId: 'message-3',
        workspaceId: 'workspace-1',
        agentId: 'build',
        toolName: 'read',
        permission: 'file.read',
        target: 'README.md',
      }),
      toolApprovalRepliedEvent.create({
        requestId: 'permission-request-1',
        sessionId: 'session-1',
        action: 'allow',
        repliedBy: { userId: 'user-1', displayName: 'Ada Lovelace' },
      }),
    ],
    when: { sessionId: 'session-1' },
    expect: [
      {
        requestId: 'permission-request-2',
        sessionId: 'session-1',
        messageId: 'message-2',
        workspaceId: 'workspace-1',
        agentId: 'build',
        toolCallId: 'tool-call-2',
        toolName: 'write',
        permission: 'file.write',
        target: 'src/index.ts',
      },
    ],
  })
  .handle(async (query, state): Promise<PendingPermission[]> => {
    return Object.values(state.pending).filter(
      (request) => request.sessionId === query.sessionId,
    )
  })

export default pendingPermissions

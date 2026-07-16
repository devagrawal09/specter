import requestToolApprovalSpec from './spec'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import { toolApprovalRequestedEvent } from '../events'

const requestToolApproval = requestToolApprovalSpec
  .inputSchema(
    z.object({
      requestId: z.string(),
      sessionId: z.string(),
      messageId: z.string(),
      workspaceId: z.string(),
      agentId: z.string(),
      toolCallId: z.string().optional(),
      toolName: z.string(),
      permission: z.string(),
      target: z.string(),
      reason: z.string().optional(),
    }),
  )
  .store(createMemorySliceStore(() => ({})))

  .handle(async (command) => {
    const permission = command.permission.trim()
    const target = command.target.trim()

    if (!permission || !target) {
      throw new Error('Permission and target are required')
    }

    return [
      toolApprovalRequestedEvent.create({
        requestId: command.requestId,
        sessionId: command.sessionId,
        messageId: command.messageId,
        workspaceId: command.workspaceId,
        agentId: command.agentId,
        toolCallId: command.toolCallId,
        toolName: command.toolName,
        permission,
        target,
        reason: command.reason,
      }),
    ]
  })

export default requestToolApproval

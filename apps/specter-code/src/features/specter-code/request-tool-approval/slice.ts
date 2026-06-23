import { createCommandSlice } from '@specter-ts/core'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import { toolApprovalRequestedEvent } from '../events'

const requestToolApproval = createCommandSlice(
  'requestToolApproval',
  'Records that an agent tool execution is waiting for user approval.',
)
  .schema(
    z.object({
      requestId: z.string().optional(),
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
  .scenarios(
    {
      description: 'Requests approval before a gated tool executes.',
      given: [],
      when: {
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
      },
      expect: [
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
      ],
    },
    {
      description: 'Rejects approval requests without a permission or target.',
      given: [],
      when: {
        sessionId: 'session-1',
        messageId: 'message-1',
        workspaceId: 'workspace-1',
        agentId: 'build',
        toolName: 'write',
        permission: '   ',
        target: '   ',
      },
      expect: [],
      reject: { reason: 'Permission and target are required' },
    },
  )
  .handle(async (command) => {
    const permission = command.permission.trim()
    const target = command.target.trim()

    if (!permission || !target) {
      throw new Error('Permission and target are required')
    }

    return [
      toolApprovalRequestedEvent.create({
        requestId: command.requestId ?? crypto.randomUUID(),
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

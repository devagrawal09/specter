import replyToolApprovalSpec from './spec'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import { toolApprovalRepliedEvent } from '../events'

const replyToolApproval = replyToolApprovalSpec
  .inputSchema(
    z.object({
      requestId: z.string(),
      sessionId: z.string(),
      action: z.enum(['allow', 'deny']),
      repliedBy: z
        .object({
          userId: z.string().optional(),
          displayName: z.string(),
        })
        .optional(),
      reason: z.string().optional(),
    }),
  )
  .store(createMemorySliceStore(() => ({})))

  .handle(async (command) => {
    return [
      toolApprovalRepliedEvent.create({
        requestId: command.requestId,
        sessionId: command.sessionId,
        action: command.action,
        repliedBy: command.repliedBy,
        reason: command.reason,
      }),
    ]
  })

export default replyToolApproval

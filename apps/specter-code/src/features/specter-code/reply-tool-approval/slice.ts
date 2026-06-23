import { createCommandSlice } from '@specter-ts/core'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import { toolApprovalRepliedEvent } from '../events'

const replyToolApproval = createCommandSlice(
  'replyToolApproval',
  'Records the user decision for a pending tool approval request.',
)
  .schema(
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
  .scenarios({
    description: 'Records an allow decision for a pending tool approval.',
    given: [],
    when: {
      requestId: 'permission-request-1',
      sessionId: 'session-1',
      action: 'allow',
      repliedBy: { userId: 'user-1', displayName: 'Ada Lovelace' },
      reason: 'Known safe command',
    },
    expect: [
      toolApprovalRepliedEvent.create({
        requestId: 'permission-request-1',
        sessionId: 'session-1',
        action: 'allow',
        repliedBy: { userId: 'user-1', displayName: 'Ada Lovelace' },
        reason: 'Known safe command',
      }),
    ],
  })
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

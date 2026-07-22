import specification from './spec.json' with { type: 'json' }
import { implementCommand } from '@specter-ts/core'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import { sessionMessageDeletedEvent } from '../events'

const deleteSessionMessage = implementCommand<'deleteSessionMessage'>(
  specification,
)
  .inputSchema(
    z.object({
      sessionId: z.string(),
      messageId: z.string(),
      deletedBy: z
        .object({ userId: z.string().optional(), displayName: z.string() })
        .optional(),
      reason: z.string().optional(),
    }),
  )
  .store(createMemorySliceStore(() => ({})))

  .handle(async (command) => [
    sessionMessageDeletedEvent.create({
      sessionId: command.sessionId,
      messageId: command.messageId,
      deletedBy: command.deletedBy,
      reason: command.reason,
    }),
  ])

export default deleteSessionMessage

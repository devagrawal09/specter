import deleteSessionMessageSpec from './spec'
import { z } from 'zod'

import { defineMemorySliceStore } from '../../../testing/memory-slice-store'
import { sessionMessageDeletedEvent } from '../events'

const deleteSessionMessage = deleteSessionMessageSpec
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
  .store(defineMemorySliceStore(() => ({})))

  .handle(async (command) => [
    sessionMessageDeletedEvent.create({
      sessionId: command.sessionId,
      messageId: command.messageId,
      deletedBy: command.deletedBy,
      reason: command.reason,
    }),
  ])

export default deleteSessionMessage

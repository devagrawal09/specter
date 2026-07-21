import deleteSessionSpec from './spec'
import { z } from 'zod'

import { defineMemorySliceStore } from '../../../testing/memory-slice-store'
import { sessionDeletedEvent } from '../events'

const deleteSession = deleteSessionSpec
  .inputSchema(
    z.object({
      sessionId: z.string(),
      deletedBy: z
        .object({
          userId: z.string().optional(),
          displayName: z.string(),
        })
        .optional(),
    }),
  )
  .store(defineMemorySliceStore(() => ({})))

  .handle(async (command) => [
    sessionDeletedEvent.create({
      sessionId: command.sessionId,
      deletedBy: command.deletedBy,
    }),
  ])

export default deleteSession

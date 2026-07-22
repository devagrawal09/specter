import specification from './spec.json' with { type: 'json' }
import { implementCommand } from '@specter-ts/core'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import { sessionDeletedEvent } from '../events'

const deleteSession = implementCommand<'deleteSession'>(specification)
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
  .store(createMemorySliceStore(() => ({})))

  .handle(async (command) => [
    sessionDeletedEvent.create({
      sessionId: command.sessionId,
      deletedBy: command.deletedBy,
    }),
  ])

export default deleteSession

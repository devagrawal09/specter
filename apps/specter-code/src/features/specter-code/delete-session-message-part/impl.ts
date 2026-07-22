import specification from './spec.json' with { type: 'json' }
import { implementCommand } from '@specter-ts/core'
import { z } from 'zod'

import { defineMemorySliceStore } from '../../../testing/memory-slice-store'
import { sessionMessagePartDeletedEvent } from '../events'

const deleteSessionMessagePart = implementCommand(specification)
  .inputSchema(
    z.object({
      sessionId: z.string(),
      messageId: z.string(),
      partId: z.string(),
    }),
  )
  .store(defineMemorySliceStore(() => ({})))

  .handle(async (command) => [
    sessionMessagePartDeletedEvent.create({
      sessionId: command.sessionId,
      messageId: command.messageId,
      partId: command.partId,
    }),
  ])

export default deleteSessionMessagePart

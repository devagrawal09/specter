import specification from './spec.json' with { type: 'json' }
import { implementCommand } from '@specter-ts/core'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import { sessionMessagePartUpdatedEvent } from '../events'

const updateSessionMessagePart = implementCommand<'updateSessionMessagePart'>(
  specification,
)
  .inputSchema(
    z.object({
      sessionId: z.string(),
      messageId: z.string(),
      partId: z.string(),
      text: z.string(),
    }),
  )
  .store(createMemorySliceStore(() => ({})))

  .handle(async (command) => {
    const content = command.text.trim()
    if (!content) throw new Error('Message part text is required')
    return [
      sessionMessagePartUpdatedEvent.create({
        sessionId: command.sessionId,
        messageId: command.messageId,
        partId: command.partId,
        content,
      }),
    ]
  })

export default updateSessionMessagePart

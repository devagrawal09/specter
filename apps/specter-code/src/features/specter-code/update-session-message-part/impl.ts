import updateSessionMessagePartSpec from './spec'
import { z } from 'zod'

import { defineMemorySliceStore } from '../../../testing/memory-slice-store'
import { sessionMessagePartUpdatedEvent } from '../events'

const updateSessionMessagePart = updateSessionMessagePartSpec
  .inputSchema(
    z.object({
      sessionId: z.string(),
      messageId: z.string(),
      partId: z.string(),
      text: z.string(),
    }),
  )
  .store(defineMemorySliceStore(() => ({})))

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

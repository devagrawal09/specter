import { createCommandSlice } from '@specter-ts/core'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import { sessionMessagePartDeletedEvent } from '../events'

const deleteSessionMessagePart = createCommandSlice(
  'deleteSessionMessagePart',
  'Deletes a supported text part from a session message.',
)
  .schema(
    z.object({
      sessionId: z.string(),
      messageId: z.string(),
      partId: z.string(),
    }),
  )
  .store(createMemorySliceStore(() => ({})))
  .scenarios({
    description: 'Records a text part deletion for a session message.',
    given: [],
    when: {
      sessionId: 'session-1',
      messageId: 'message-1',
      partId: 'part_text',
    },
    expect: [
      sessionMessagePartDeletedEvent.create({
        sessionId: 'session-1',
        messageId: 'message-1',
        partId: 'part_text',
      }),
    ],
  })
  .handle(async (command) => [
    sessionMessagePartDeletedEvent.create({
      sessionId: command.sessionId,
      messageId: command.messageId,
      partId: command.partId,
    }),
  ])

export default deleteSessionMessagePart

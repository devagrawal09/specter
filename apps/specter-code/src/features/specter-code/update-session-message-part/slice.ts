import { createCommandSlice } from '@specter-ts/core'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import { sessionMessagePartUpdatedEvent } from '../events'

const updateSessionMessagePart = createCommandSlice(
  'updateSessionMessagePart',
  'Updates the text content for a supported session message part.',
)
  .schema(
    z.object({
      sessionId: z.string(),
      messageId: z.string(),
      partId: z.string(),
      text: z.string(),
    }),
  )
  .store(createMemorySliceStore(() => ({})))
  .scenarios(
    {
      description: 'Records a text part update for a session message.',
      given: [],
      when: {
        sessionId: 'session-1',
        messageId: 'message-1',
        partId: 'part_text',
        text: '  updated prompt  ',
      },
      expect: [
        sessionMessagePartUpdatedEvent.create({
          sessionId: 'session-1',
          messageId: 'message-1',
          partId: 'part_text',
          content: 'updated prompt',
        }),
      ],
    },
    {
      description: 'Rejects a blank text part update.',
      given: [],
      when: {
        sessionId: 'session-1',
        messageId: 'message-1',
        partId: 'part_text',
        text: '   ',
      },
      expect: [],
      reject: { reason: 'Message part text is required' },
    },
  )
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

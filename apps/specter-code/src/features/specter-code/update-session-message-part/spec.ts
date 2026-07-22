import { createCommandSlice, event } from '@specter-ts/spec'

const updateSessionMessagePartSpec = createCommandSlice(
  'updateSessionMessagePart',
)
  .description('Updates the text content for a supported session message part.')
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
        event('session-message-part-updated', {
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

export default updateSessionMessagePartSpec

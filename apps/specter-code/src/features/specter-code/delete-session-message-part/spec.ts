import { createCommandSlice, event } from '@specter-ts/spec'

const deleteSessionMessagePartSpec = createCommandSlice(
  'deleteSessionMessagePart',
)
  .description('Deletes a supported text part from a session message.')
  .scenarios({
    description: 'Records a text part deletion for a session message.',
    given: [],
    when: {
      sessionId: 'session-1',
      messageId: 'message-1',
      partId: 'part_text',
    },
    expect: [
      event('session-message-part-deleted', {
        sessionId: 'session-1',
        messageId: 'message-1',
        partId: 'part_text',
      }),
    ],
  })

export default deleteSessionMessagePartSpec

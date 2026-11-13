import { createCommandSlice, event } from '@specter-ts/spec'

export default createCommandSlice('appendMessage')
  .description('Appends a stream chunk at an exact text offset.')
  .scenarios(
    {
      description: 'Appends the next chunk.',
      given: [
        event('message-posted', {
          messageId: 'msg-1',
          documentId: 'doc-1',
          text: 'Review',
        }),
      ],
      when: { messageId: 'msg-1', offset: 6, chunk: ' now' },
      expect: [
        event('message-chunk-appended', {
          messageId: 'msg-1',
          offset: 6,
          chunk: ' now',
        }),
      ],
    },
    {
      description: 'Rejects a missing message.',
      given: [],
      when: { messageId: 'msg-1', offset: 6, chunk: ' now' },
      reject: { reason: 'Message not found' },
      expect: [],
    },
    {
      description: 'Rejects a repeated offset.',
      given: [
        event('message-posted', {
          messageId: 'msg-1',
          documentId: 'doc-1',
          text: 'Review',
        }),
        event('message-chunk-appended', {
          messageId: 'msg-1',
          offset: 6,
          chunk: ' now',
        }),
      ],
      when: { messageId: 'msg-1', offset: 6, chunk: ' now' },
      reject: { reason: 'Message offset conflict' },
      expect: [],
    },
  )

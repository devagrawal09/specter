import { createCommandSlice, event } from '@specter-ts/spec'

export default createCommandSlice('postMessage')
  .description('Posts a message linked to an existing document.')
  .scenarios(
    {
      description: 'Posts a linked message.',
      given: [
        event('document-saved', {
          documentId: 'doc-1',
          title: 'Plan',
          body: 'Ship',
          revision: 1,
        }),
      ],
      when: { messageId: 'msg-1', documentId: 'doc-1', text: 'Review' },
      expect: [
        event('message-posted', {
          messageId: 'msg-1',
          documentId: 'doc-1',
          text: 'Review',
        }),
      ],
    },
    {
      description: 'Rejects a missing document.',
      given: [],
      when: { messageId: 'msg-1', documentId: 'doc-1', text: 'Review' },
      reject: { reason: 'Document not found' },
      expect: [],
    },
    {
      description: 'Rejects a duplicate message.',
      given: [
        event('document-saved', {
          documentId: 'doc-1',
          title: 'Plan',
          body: 'Ship',
          revision: 1,
        }),
        event('message-posted', {
          messageId: 'msg-1',
          documentId: 'doc-1',
          text: 'Review',
        }),
      ],
      when: { messageId: 'msg-1', documentId: 'doc-1', text: 'Review' },
      reject: { reason: 'Message already exists' },
      expect: [],
    },
  )

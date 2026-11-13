import { createCommandSlice, event } from '@specter-ts/spec'

export default createCommandSlice('saveDocument')
  .description('Saves a complete document with a document-local revision.')
  .scenarios(
    {
      description: 'Creates a document.',
      given: [],
      when: {
        documentId: 'doc-1',
        title: 'Plan',
        body: 'Ship',
        revision: 1,
        expectedRevision: 0,
      },
      expect: [
        event('document-saved', {
          documentId: 'doc-1',
          title: 'Plan',
          body: 'Ship',
          revision: 1,
        }),
      ],
    },
    {
      description: 'Rejects a stale edit.',
      given: [
        event('document-saved', {
          documentId: 'doc-1',
          title: 'Plan',
          body: 'Ship',
          revision: 1,
        }),
      ],
      when: {
        documentId: 'doc-1',
        title: 'Plan',
        body: 'Ship',
        revision: 1,
        expectedRevision: 0,
      },
      reject: { reason: 'Document revision conflict' },
      expect: [],
    },
  )

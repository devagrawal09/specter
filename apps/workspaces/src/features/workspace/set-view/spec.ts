import { createCommandSlice, event } from '@specter-ts/spec'

export default createCommandSlice('setView')
  .description(
    'Records session selection and draft text as ordinary application state.',
  )
  .scenarios(
    {
      description: 'Records selection and draft.',
      given: [
        event('document-saved', {
          documentId: 'doc-1',
          title: 'Plan',
          body: 'Ship',
          revision: 1,
        }),
      ],
      when: {
        sessionId: 'session-1',
        documentId: 'doc-1',
        draft: 'Working',
        baseRevision: 1,
        revision: 1,
        expectedRevision: 0,
      },
      expect: [
        event('view-set', {
          sessionId: 'session-1',
          documentId: 'doc-1',
          draft: 'Working',
          baseRevision: 1,
          revision: 1,
        }),
      ],
    },
    {
      description: 'Rejects a missing document.',
      given: [],
      when: {
        sessionId: 'session-1',
        documentId: 'doc-1',
        draft: 'Working',
        baseRevision: 1,
        revision: 1,
        expectedRevision: 0,
      },
      reject: { reason: 'Document not found' },
      expect: [],
    },
    {
      description: 'Rejects a stale view.',
      given: [
        event('document-saved', {
          documentId: 'doc-1',
          title: 'Plan',
          body: 'Ship',
          revision: 1,
        }),
        event('view-set', {
          sessionId: 'session-1',
          documentId: 'doc-1',
          draft: 'Working',
          baseRevision: 1,
          revision: 1,
        }),
      ],
      when: {
        sessionId: 'session-1',
        documentId: 'doc-1',
        draft: 'Working',
        baseRevision: 1,
        revision: 1,
        expectedRevision: 0,
      },
      reject: { reason: 'View revision conflict' },
      expect: [],
    },
  )

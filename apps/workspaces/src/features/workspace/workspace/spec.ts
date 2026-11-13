import { createQuerySlice, event } from '@specter-ts/spec'

export default createQuerySlice('workspace')
  .description(
    'Returns accumulated workspace state, including streams and session drafts.',
  )
  .scenarios(
    {
      description: 'Starts empty.',
      given: [],
      when: {},
      expect: { documents: {}, messages: {}, tasks: {}, views: {} },
    },
    {
      description: 'Rebuilds linked content and session state.',
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
        event('task-set', {
          taskId: 'task-1',
          messageId: 'msg-1',
          title: 'Review plan',
          done: false,
          revision: 1,
        }),
        event('view-set', {
          sessionId: 'session-1',
          documentId: 'doc-1',
          draft: 'Working',
          baseRevision: 1,
          revision: 1,
        }),
        event('message-chunk-appended', {
          messageId: 'msg-1',
          offset: 6,
          chunk: ' now',
        }),
      ],
      when: {},
      expect: {
        documents: {
          'doc-1': {
            documentId: 'doc-1',
            title: 'Plan',
            body: 'Ship',
            revision: 1,
          },
        },
        messages: {
          'msg-1': {
            messageId: 'msg-1',
            documentId: 'doc-1',
            text: 'Review now',
          },
        },
        tasks: {
          'task-1': {
            taskId: 'task-1',
            messageId: 'msg-1',
            title: 'Review plan',
            done: false,
            revision: 1,
          },
        },
        views: {
          'session-1': {
            sessionId: 'session-1',
            documentId: 'doc-1',
            draft: 'Working',
            baseRevision: 1,
            revision: 1,
          },
        },
      },
    },
  )

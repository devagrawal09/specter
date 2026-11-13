import { createCommandSlice, event } from '@specter-ts/spec'

export default createCommandSlice('setTask')
  .description(
    'Creates or updates a task linked to a message, using task-local revisions.',
  )
  .scenarios(
    {
      description: 'Creates a task from a message.',
      given: [
        event('message-posted', {
          messageId: 'msg-1',
          documentId: 'doc-1',
          text: 'Review',
        }),
      ],
      when: {
        taskId: 'task-1',
        messageId: 'msg-1',
        title: 'Review plan',
        done: false,
        revision: 1,
        expectedRevision: 0,
      },
      expect: [
        event('task-set', {
          taskId: 'task-1',
          messageId: 'msg-1',
          title: 'Review plan',
          done: false,
          revision: 1,
        }),
      ],
    },
    {
      description: 'Rejects a missing message.',
      given: [],
      when: {
        taskId: 'task-1',
        messageId: 'msg-1',
        title: 'Review plan',
        done: false,
        revision: 1,
        expectedRevision: 0,
      },
      reject: { reason: 'Message not found' },
      expect: [],
    },
    {
      description: 'Rejects a stale task update.',
      given: [
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
      ],
      when: {
        taskId: 'task-1',
        messageId: 'msg-1',
        title: 'Review plan',
        done: false,
        revision: 1,
        expectedRevision: 0,
      },
      reject: { reason: 'Task revision conflict' },
      expect: [],
    },
  )

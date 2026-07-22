import { createCommandSlice, event } from '@specter-ts/spec'

const updateTodoListSpec = createCommandSlice('updateTodoList')
  .description('Records the latest todo list for an OpenCode-style session.')
  .scenarios(
    {
      description: 'Records a normalized todo list for a session message.',
      given: [],
      when: {
        sessionId: 'session-todos-1',
        messageId: 'message-todos-1',
        items: [
          {
            id: 'todo-1',
            content: ' Inspect failure ',
            status: 'in_progress',
            priority: 'high',
          },
          { id: 'todo-2', content: 'Ship fix', status: 'pending' },
        ],
      },
      expect: [
        event('todo-list-updated', {
          sessionId: 'session-todos-1',
          messageId: 'message-todos-1',
          items: [
            {
              id: 'todo-1',
              content: 'Inspect failure',
              status: 'in_progress',
              priority: 'high',
            },
            { id: 'todo-2', content: 'Ship fix', status: 'pending' },
          ],
        }),
      ],
    },
    {
      description: 'Rejects todos with empty content.',
      given: [],
      when: {
        sessionId: 'session-todos-1',
        messageId: 'message-todos-1',
        items: [{ id: 'todo-empty', content: '   ', status: 'pending' }],
      },
      expect: [],
      reject: { reason: 'Todo content is required' },
    },
  )

export default updateTodoListSpec

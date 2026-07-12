import { createQuerySlice, event } from '@specter-ts/core/spec'

const sessionTodosSpec = createQuerySlice('sessionTodos')
  .description('Lists the latest todo list for a session.')
  .scenarios(
{
    description: 'Returns the latest todo list for the queried session.',
    given: [
      event('todo-list-updated', {
        sessionId: 'session-todos-1',
        messageId: 'message-todos-1',
        items: [
          { id: 'todo-1', content: 'Inspect failure', status: 'in_progress', priority: 'high' },
          { id: 'todo-2', content: 'Ship fix', status: 'pending' },
        ],
      }),
      event('todo-list-updated', {
        sessionId: 'session-todos-other',
        messageId: 'message-todos-other',
        items: [{ id: 'todo-other', content: 'Ignore me', status: 'pending' }],
      }),
      event('todo-list-updated', {
        sessionId: 'session-todos-1',
        messageId: 'message-todos-2',
        items: [{ id: 'todo-1', content: 'Inspect failure', status: 'completed', priority: 'high' }],
      }),
    ],
    when: { sessionId: 'session-todos-1' },
    expect: [
      { id: 'todo-1', content: 'Inspect failure', status: 'completed', priority: 'high' },
    ],
  }
  )

export default sessionTodosSpec

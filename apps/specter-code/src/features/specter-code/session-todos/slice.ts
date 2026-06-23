import { createQuerySlice } from '@specter-ts/core'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import { todoListUpdatedEvent } from '../events'

type TodoStatus = 'pending' | 'in_progress' | 'completed'
type TodoPriority = 'low' | 'medium' | 'high'

type SessionTodo = {
  id: string
  content: string
  status: TodoStatus
  priority?: TodoPriority
}

type SessionTodosState = {
  bySession: Record<string, SessionTodo[]>
}

const sessionTodos = createQuerySlice(
  'sessionTodos',
  'Lists the latest todo list for a session.',
)
  .schema(
    z.object({
      sessionId: z.string(),
    }),
  )
  .store(createMemorySliceStore<SessionTodosState>(() => ({ bySession: {} })))
  .apply({
    [todoListUpdatedEvent.type]: async (event, state) => {
      const payload = await todoListUpdatedEvent.decode(event.payload)
      state.bySession[payload.sessionId] = payload.items.map((item) => ({ ...item }))
    },
  })
  .scenarios({
    description: 'Returns the latest todo list for the queried session.',
    given: [
      todoListUpdatedEvent.create({
        sessionId: 'session-todos-1',
        messageId: 'message-todos-1',
        items: [
          { id: 'todo-1', content: 'Inspect failure', status: 'in_progress', priority: 'high' },
          { id: 'todo-2', content: 'Ship fix', status: 'pending' },
        ],
      }),
      todoListUpdatedEvent.create({
        sessionId: 'session-todos-other',
        messageId: 'message-todos-other',
        items: [{ id: 'todo-other', content: 'Ignore me', status: 'pending' }],
      }),
      todoListUpdatedEvent.create({
        sessionId: 'session-todos-1',
        messageId: 'message-todos-2',
        items: [{ id: 'todo-1', content: 'Inspect failure', status: 'completed', priority: 'high' }],
      }),
    ],
    when: { sessionId: 'session-todos-1' },
    expect: [
      { id: 'todo-1', content: 'Inspect failure', status: 'completed', priority: 'high' },
    ],
  })
  .handle(async (query, state): Promise<SessionTodo[]> => {
    return state.bySession[query.sessionId] ?? []
  })

export default sessionTodos

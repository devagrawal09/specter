import specification from './spec.json' with { type: 'json' }
import { implementQuery } from '@specter-ts/core'
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

const sessionTodos = implementQuery<'sessionTodos'>(specification)
  .inputSchema(
    z.object({
      sessionId: z.string(),
    }),
  )
  .outputSchema<SessionTodo[]>()
  .store(createMemorySliceStore<SessionTodosState>(() => ({ bySession: {} })))
  .apply(todoListUpdatedEvent, async (event, state) => {
    const payload = event.payload
    state.bySession[payload.sessionId] = payload.items.map((item) => ({
      ...item,
    }))
  })

  .handle(async (query, state): Promise<SessionTodo[]> => {
    return state.bySession[query.sessionId] ?? []
  })

export default sessionTodos

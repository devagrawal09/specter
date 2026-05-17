import { eq } from 'drizzle-orm'
import { z } from 'zod'

import type { TodoEvent } from '../../shared/todo-events'
import type {
  StoredTodoEvent,
  TodoStore,
} from '../../shared/todo-persistence-types'
import { todoCompletionStates } from './schema'

export type ChangeTodoCompletionCommand = {
  todoId: string
  completed: boolean
}

export const changeTodoCompletionInput = z.object({
  todoId: z.string().min(1, 'Todo id is required'),
  completed: z.boolean(),
})

export function decideChangeTodoCompletion(
  tx: TodoStore,
  command: ChangeTodoCompletionCommand,
  now = new Date(),
): TodoEvent[] {
  const todo = tx
    .select()
    .from(todoCompletionStates)
    .where(eq(todoCompletionStates.todoId, command.todoId))
    .get()

  if (!todo || todo.removedAt) {
    throw new Error('Todo not found')
  }

  if (todo.completed === command.completed) {
    return []
  }

  return [
    {
      type: 'todoCompletionChanged',
      payload: {
        todoId: command.todoId,
        completed: command.completed,
        updatedAt: now.toISOString(),
      },
    },
  ]
}

export function applyChangeTodoCompletionEvents(
  tx: TodoStore,
  events: StoredTodoEvent[],
) {
  for (const event of events) {
    if (event.type === 'todoAdded') {
      tx.insert(todoCompletionStates)
        .values({
          todoId: event.payload.todoId,
          completed: false,
          removedAt: null,
          lastAppliedEventId: event.id,
        })
        .run()
    }

    if (event.type === 'todoCompletionChanged') {
      tx.update(todoCompletionStates)
        .set({
          completed: event.payload.completed,
          lastAppliedEventId: event.id,
        })
        .where(eq(todoCompletionStates.todoId, event.payload.todoId))
        .run()
    }

    if (event.type === 'todoRemoved') {
      tx.update(todoCompletionStates)
        .set({
          removedAt: new Date(event.payload.removedAt),
          lastAppliedEventId: event.id,
        })
        .where(eq(todoCompletionStates.todoId, event.payload.todoId))
        .run()
    }
  }
}

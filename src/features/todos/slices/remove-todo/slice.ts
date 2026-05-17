import { eq } from 'drizzle-orm'
import { z } from 'zod'

import type { TodoEvent } from '../../shared/todo-events'
import type {
  StoredTodoEvent,
  TodoStore,
} from '../../shared/todo-persistence-types'
import { todoRemovalStates } from './schema'

export type RemoveTodoCommand = { todoId: string }

export const removeTodoInput = z.object({
  todoId: z.string().min(1, 'Todo id is required'),
})

export function decideRemoveTodo(
  tx: TodoStore,
  command: RemoveTodoCommand,
  now = new Date(),
): TodoEvent[] {
  const todo = tx
    .select()
    .from(todoRemovalStates)
    .where(eq(todoRemovalStates.todoId, command.todoId))
    .get()

  if (!todo || todo.removedAt) {
    throw new Error('Todo not found')
  }

  return [
    {
      type: 'todoRemoved',
      payload: { todoId: command.todoId, removedAt: now.toISOString() },
    },
  ]
}

export function applyRemoveTodoEvents(
  tx: TodoStore,
  events: StoredTodoEvent[],
) {
  for (const event of events) {
    if (event.type === 'todoAdded') {
      tx.insert(todoRemovalStates)
        .values({
          todoId: event.payload.todoId,
          removedAt: null,
          lastAppliedEventId: event.id,
        })
        .run()
    }

    if (event.type === 'todoRemoved') {
      tx.update(todoRemovalStates)
        .set({
          removedAt: new Date(event.payload.removedAt),
          lastAppliedEventId: event.id,
        })
        .where(eq(todoRemovalStates.todoId, event.payload.todoId))
        .run()
    }
  }
}

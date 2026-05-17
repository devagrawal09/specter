import { eq } from 'drizzle-orm'
import { z } from 'zod'

import type { TodoEvent } from '../../shared/todo-events'
import type {
  StoredTodoEvent,
  TodoStore,
} from '../../shared/todo-persistence-types'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const todoRemovalStates = sqliteTable('todo_removal_states', {
  todoId: text('todo_id').primaryKey(),
  removed: integer('removed', { mode: 'boolean' }).notNull().default(false),
  lastAppliedEventId: integer('last_applied_event_id').notNull(),
})

export type RemoveTodoCommand = { todoId: string }

export const removeTodoInput = z.object({
  todoId: z.string().min(1, 'Todo id is required'),
})

export function decideRemoveTodo(
  tx: TodoStore,
  command: RemoveTodoCommand,
): TodoEvent[] {
  const todo = tx
    .select()
    .from(todoRemovalStates)
    .where(eq(todoRemovalStates.todoId, command.todoId))
    .get()

  if (!todo || todo.removed) {
    throw new Error('Todo not found')
  }

  return [
    {
      type: 'todoRemoved',
      payload: { todoId: command.todoId },
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
          lastAppliedEventId: event.id,
        })
        .run()
    }

    if (event.type === 'todoRemoved') {
      tx.update(todoRemovalStates)
        .set({
          removed: true,
          lastAppliedEventId: event.id,
        })
        .where(eq(todoRemovalStates.todoId, event.payload.todoId))
        .run()
    }
  }
}

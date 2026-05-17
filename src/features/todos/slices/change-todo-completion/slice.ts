import { eq } from 'drizzle-orm'
import { z } from 'zod'

import type { TodoEvent } from '../../shared'
import type { StoredTodoEvent, TodoStore } from '../../shared'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const todoCompletionStates = sqliteTable('todo_completion_states', {
  todoId: text('todo_id').primaryKey(),
  completed: integer('completed', { mode: 'boolean' }).notNull().default(false),
  removed: integer('removed', { mode: 'boolean' }).notNull().default(false),
  lastAppliedEventId: integer('last_applied_event_id').notNull(),
})
export type ChangeTodoCompletionCommand = {
  todoId: string
}

export const changeTodoCompletionInput = z.object({
  todoId: z.string().min(1, 'Todo id is required'),
})

export function decideChangeTodoCompletion(
  tx: TodoStore,
  command: ChangeTodoCompletionCommand,
): TodoEvent[] {
  const todo = tx
    .select()
    .from(todoCompletionStates)
    .where(eq(todoCompletionStates.todoId, command.todoId))
    .get()

  if (!todo || todo.removed) {
    throw new Error('Todo not found')
  }

  return [
    {
      type: 'todoCompletionChanged',
      payload: {
        todoId: command.todoId,
        completed: !todo.completed,
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
          removed: true,
          lastAppliedEventId: event.id,
        })
        .where(eq(todoCompletionStates.todoId, event.payload.todoId))
        .run()
    }
  }
}

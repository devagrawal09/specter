import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'

export const todoCompletionStates = sqliteTable('todo_completion_states', {
  todoId: text('todo_id').primaryKey(),
  completed: integer('completed', { mode: 'boolean' }).notNull().default(false),
  removed: integer('removed', { mode: 'boolean' }).notNull().default(false),
  lastAppliedEventId: integer('last_applied_event_id').notNull(),
})

export const changeTodoCompletionInput = z.object({
  todoId: z.string().min(1, 'Todo id is required'),
  completed: z.boolean(),
})

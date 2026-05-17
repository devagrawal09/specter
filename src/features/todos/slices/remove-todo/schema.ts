import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'

export const todoRemovalStates = sqliteTable('todo_removal_states', {
  todoId: text('todo_id').primaryKey(),
  removed: integer('removed', { mode: 'boolean' }).notNull().default(false),
  lastAppliedEventId: integer('last_applied_event_id').notNull(),
})

export const removeTodoInput = z.object({
  todoId: z.string().min(1, 'Todo id is required'),
})

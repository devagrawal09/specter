import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const todoCompletionStates = sqliteTable('todo_completion_states', {
  todoId: text('todo_id').primaryKey(),
  completed: integer('completed', { mode: 'boolean' }).notNull().default(false),
  removedAt: integer('removed_at', { mode: 'timestamp' }),
  lastAppliedEventId: integer('last_applied_event_id').notNull(),
})

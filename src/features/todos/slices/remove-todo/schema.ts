import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const todoRemovalStates = sqliteTable('todo_removal_states', {
  todoId: text('todo_id').primaryKey(),
  removedAt: integer('removed_at', { mode: 'timestamp' }),
  lastAppliedEventId: integer('last_applied_event_id').notNull(),
})

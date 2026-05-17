import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'

export const todoStatusFilterInput = z.enum(['all', 'active', 'completed'])

export const todosViewQueryInput = z.object({
  status: todoStatusFilterInput.catch('all'),
})

export type TodoStatusFilter = z.infer<typeof todoStatusFilterInput>

export function parseTodosViewSearch(search: Record<string, unknown>) {
  return todosViewQueryInput.parse(search)
}

export const todoListItems = sqliteTable('todo_list_items', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  completed: integer('completed', { mode: 'boolean' }).notNull().default(false),
  removed: integer('removed', { mode: 'boolean' }).default(false),
  lastAppliedEventId: integer('last_applied_event_id').notNull(),
})

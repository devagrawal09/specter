import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const todoEvents = sqliteTable('todo_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  type: text('type').notNull(),
  payload: text('payload').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
})

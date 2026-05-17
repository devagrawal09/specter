import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const todoEvents = sqliteTable('todo_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  type: text('type').notNull(),
  payload: text('payload').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
})

export const todos = sqliteTable('todos', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  completed: integer('completed', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  removedAt: integer('removed_at', { mode: 'timestamp' }),
})

import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import type * as schema from '../../../db/schema'

export const todoEvents = sqliteTable('todo_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  type: text('type').notNull(),
  payload: text('payload').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
})

export type TodoEvent =
  | {
      type: 'todoAdded'
      payload: { todoId: string; title: string }
    }
  | {
      type: 'todoCompletionChanged'
      payload: { todoId: string; completed: boolean }
    }
  | {
      type: 'todoRemoved'
      payload: { todoId: string }
    }

export type StoredTodoEvent = TodoEvent & {
  id: number
}

export type TodoStore = Pick<
  BetterSQLite3Database<typeof schema>,
  'insert' | 'select' | 'update'
>

export function todoAdded(todoId: string, title: string): TodoEvent {
  return {
    type: 'todoAdded',
    payload: { todoId, title },
  }
}

export function todoCompleted(todoId: string): TodoEvent {
  return {
    type: 'todoCompletionChanged',
    payload: { todoId, completed: true },
  }
}

export function todoRemoved(todoId: string): TodoEvent {
  return {
    type: 'todoRemoved',
    payload: { todoId },
  }
}

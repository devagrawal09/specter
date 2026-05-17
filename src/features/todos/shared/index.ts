import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'

export const todoEvents = sqliteTable('todo_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  type: text('type').notNull(),
  payload: text('payload').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
})

export type Event =
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

export type StoredTodoEvent = Event & {
  id: number
}

export type StoreTx = Pick<
  // biome-ignore lint/suspicious/noExplicitAny: explicit any
  BetterSQLite3Database<any>,
  'insert' | 'select' | 'update'
>

export function todoAdded(todoId: string, title: string): Event {
  return {
    type: 'todoAdded',
    payload: { todoId, title },
  }
}

export function todoCompleted(todoId: string): Event {
  return {
    type: 'todoCompletionChanged',
    payload: { todoId, completed: true },
  }
}

export function todoRemoved(todoId: string): Event {
  return {
    type: 'todoRemoved',
    payload: { todoId },
  }
}

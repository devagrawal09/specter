import { eq } from 'drizzle-orm'

import type { StoredTodoEvent, TodoStore } from '../../shared'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const todoListItems = sqliteTable('todo_list_items', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  completed: integer('completed', { mode: 'boolean' }).notNull().default(false),
  removed: integer('removed', { mode: 'boolean' }).default(false),
  lastAppliedEventId: integer('last_applied_event_id').notNull(),
})

export function mutateTodoListItemsFromEvents(
  tx: TodoStore,
  events: StoredTodoEvent[],
) {
  for (const event of events) {
    if (event.type === 'todoAdded') {
      tx.insert(todoListItems)
        .values({
          id: event.payload.todoId,
          title: event.payload.title,
          completed: false,
          lastAppliedEventId: event.id,
        })
        .run()
    }

    if (event.type === 'todoCompletionChanged') {
      tx.update(todoListItems)
        .set({
          completed: event.payload.completed,
          lastAppliedEventId: event.id,
        })
        .where(eq(todoListItems.id, event.payload.todoId))
        .run()
    }

    if (event.type === 'todoRemoved') {
      tx.update(todoListItems)
        .set({
          removed: true,
          lastAppliedEventId: event.id,
        })
        .where(eq(todoListItems.id, event.payload.todoId))
        .run()
    }
  }
}

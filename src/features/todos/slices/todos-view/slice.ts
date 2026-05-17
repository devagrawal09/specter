import { eq } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { lazy } from 'solid-js'
import { z } from 'zod'
import { createProjectionSlice } from '../../registry.builders'
import {
  todoAddedEvent,
  todoCompletionChangedEvent,
  todoRemovedEvent,
} from '../../shared'

const todoStatusFilterInput = z.enum(['all', 'active', 'completed'])

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
  lastAppliedEventId: text('last_applied_event_id').notNull(),
})

export const todosViewSliceRegistration = createProjectionSlice('todosView')
  .schema(todosViewQueryInput)
  .apply((event, tx) => {
    if (todoAddedEvent.is(event)) {
      tx.insert(todoListItems)
        .values({
          id: event.payload.todoId,
          title: event.payload.title,
          completed: false,
          lastAppliedEventId: event.id,
        })
        .run()
    }

    if (todoCompletionChangedEvent.is(event)) {
      tx.update(todoListItems)
        .set({
          completed: event.payload.completed,
          lastAppliedEventId: event.id,
        })
        .where(eq(todoListItems.id, event.payload.todoId))
        .run()
    }

    if (todoRemovedEvent.is(event)) {
      tx.update(todoListItems)
        .set({
          removed: true,
          lastAppliedEventId: event.id,
        })
        .where(eq(todoListItems.id, event.payload.todoId))
        .run()
    }
  })
  .component(
    lazy(() =>
      import('./TodosView').then((module) => ({ default: module.TodosView })),
    ),
  )

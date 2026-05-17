import { eq } from 'drizzle-orm'
import { lazy } from 'solid-js'
import { createProjectionSlice } from '../../registry.builders'
import { todoListItems, todosViewQueryInput } from './model'

export const todosViewSliceRegistration = createProjectionSlice('todosView')
  .schema(todosViewQueryInput)
  .applyEvents((tx, events) => {
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
  })
  .component(
    lazy(() =>
      import('./TodosView').then((module) => ({ default: module.TodosView })),
    ),
  )

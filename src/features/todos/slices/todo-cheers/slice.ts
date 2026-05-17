import { desc } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { lazy } from 'solid-js'
import { z } from 'zod'
import { createProjectionSpec } from '../../registry.builders'
import { todoCheerCreatedEvent } from '../../shared'

export const todoCheersQueryInput = z.object({})

export const todoCheers = sqliteTable('todo_cheers', {
  milestone: integer('milestone').primaryKey(),
  message: text('message').notNull(),
})

export type TodoCheer = typeof todoCheers.$inferSelect

export const todoCheersSliceRegistration = createProjectionSpec('todoCheers')
  .schema(todoCheersQueryInput)
  .apply((event, tx) => {
    if (!todoCheerCreatedEvent.is(event)) {
      return
    }

    tx.insert(todoCheers)
      .values({
        milestone: event.payload.milestone,
        message: event.payload.message,
      })
      .run()
  })
  .component(
    lazy(() =>
      import('./TodoCheersView').then((module) => ({
        default: module.TodoCheersView,
      })),
    ),
  )

export const latestTodoCheerOrder = desc(todoCheers.milestone)

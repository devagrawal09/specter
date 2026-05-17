import { desc } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'
import { createProjectionSlice } from '../../registry.builders'
import { todoCheerCreatedEvent } from '../../shared'

export const todoCheersQueryInput = z.object({})

export const todoCheers = sqliteTable('todo_cheers', {
  milestone: integer('milestone').primaryKey(),
  message: text('message').notNull(),
  lastAppliedEventId: integer('last_applied_event_id').notNull(),
})

export type TodoCheer = typeof todoCheers.$inferSelect

export const todoCheersSliceRegistration = createProjectionSlice('todoCheers')
  .schema(todoCheersQueryInput)
  .apply((event, tx) => {
    if (!todoCheerCreatedEvent.is(event)) {
      return
    }

    tx.insert(todoCheers)
      .values({
        milestone: event.payload.milestone,
        message: event.payload.message,
        lastAppliedEventId: event.id,
      })
      .run()
  })
  .component(() => null)

export const latestTodoCheerOrder = desc(todoCheers.milestone)

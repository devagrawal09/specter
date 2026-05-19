import { desc } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'
import { createProjectionSpec } from '../../lib/registry.builders'
import { todoCheerCreatedEvent } from '../events'

export const todoCheersQueryInput = z.object({})

export const todoCheers = sqliteTable('todo_cheers', {
  milestone: integer('milestone').primaryKey(),
  message: text('message').notNull(),
})

export type TodoCheer = typeof todoCheers.$inferSelect

export type TodoCheersState = {
  latestCheer: TodoCheer | null
}

export const todoCheersSliceRegistration = createProjectionSpec('todoCheers')
  .schema(todoCheersQueryInput)
  .apply({
    [todoCheerCreatedEvent.type]: (event, tx) => {
      tx.insert(todoCheers)
        .values({
          milestone: event.payload.milestone,
          message: event.payload.message,
        })
        .run()
    },
  })
  .state({ latestCheer: null } as TodoCheersState)
  .scenarios(
    {
      given: [],
      when: {},
      expect: { latestCheer: null },
    },
    {
      given: [
        todoCheerCreatedEvent.create({
          milestone: 5,
          message: 'Nice work: 5 todos completed.',
        }),
        todoCheerCreatedEvent.create({
          milestone: 10,
          message: 'Nice work: 10 todos completed.',
        }),
      ],
      when: {},
      expect: {
        latestCheer: {
          milestone: 10,
          message: 'Nice work: 10 todos completed.',
        },
      },
    },
  )
  .query((tx) => ({
    latestCheer:
      tx
        .select()
        .from(todoCheers)
        .orderBy(latestTodoCheerOrder)
        .limit(1)
        .get() ?? null,
  }))

export const latestTodoCheerOrder = desc(todoCheers.milestone)

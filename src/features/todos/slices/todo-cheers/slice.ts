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
  .scenarios(
    {
      given: [],
      when: {},
      expect: {
        hidden: ['todo-cheer'],
      },
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
        visible: ['todo-cheer'],
        text: {
          'todo-cheer': 'Nice work: 10 todos completed.',
        },
      },
    },
  )
  .component(
    lazy(() =>
      import('./TodoCheersView').then((module) => ({
        default: module.TodoCheersView,
      })),
    ),
  )

export const latestTodoCheerOrder = desc(todoCheers.milestone)

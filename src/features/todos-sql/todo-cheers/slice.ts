import { desc } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'
import { createProjectionSpec } from '../../../lib/registry.builders'
import { todoCheerCreatedEvent } from '../../todos/events'

export const todoSqlCheersState = sqliteTable('todo_sql_cheers', {
  milestone: integer('milestone').primaryKey(),
  message: text('message').notNull(),
})

export type TodoSqlCheer = typeof todoSqlCheersState.$inferSelect

export type TodoSqlCheersState = {
  latestCheer: TodoSqlCheer | null
}

export const todoSqlCheers = createProjectionSpec('todoCheers')
  .schema(z.object({}))
  .apply({
    [todoCheerCreatedEvent.type]: (event, tx) => {
      tx.insert(todoSqlCheersState)
        .values({
          milestone: event.payload.milestone,
          message: event.payload.message,
        })
        .run()
    },
  })
  .state({ latestCheer: null } as TodoSqlCheersState)
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
        .from(todoSqlCheersState)
        .orderBy(desc(todoSqlCheersState.milestone))
        .limit(1)
        .get() ?? null,
  }))

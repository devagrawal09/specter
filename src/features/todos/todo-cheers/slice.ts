import { desc } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { Effect } from 'effect'
import * as Schema from 'effect/Schema'
import { createQuerySlice } from '../../../lib'
import { todoCheerCreatedEvent } from '../events'

export const todoSqlCheersState = sqliteTable('todo_sql_cheers', {
  milestone: integer('milestone').primaryKey(),
  message: text('message').notNull(),
})

export type TodoSqlCheer = typeof todoSqlCheersState.$inferSelect

export type TodoSqlCheersState = {
  latestCheer: TodoSqlCheer | null
}

const todoSqlCheers = createQuerySlice('todoCheers')
  .schema(Schema.Struct({}))
  .apply({
    [todoCheerCreatedEvent.type]: (event, input) =>
      Effect.gen(function* () {
        const db = input
        const payload = todoCheerCreatedEvent.decode(event.payload)

        yield* db.insert(todoSqlCheersState).values({
          milestone: payload.milestone,
          message: payload.message,
        })
      }),
  })
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
  .handle((input) =>
    Effect.gen(function* () {
      const db = input
      const latestCheers = yield* db
        .select()
        .from(todoSqlCheersState)
        .orderBy(desc(todoSqlCheersState.milestone))
        .limit(1)

      const state: TodoSqlCheersState = { latestCheer: latestCheers[0] ?? null }

      return state
    }),
  )

export default todoSqlCheers

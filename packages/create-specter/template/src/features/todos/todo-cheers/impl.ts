import { desc } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'

import { sqliteSliceStore } from '../../../db/specter-store'
import { todoCheerCreatedEvent } from '../events'
import specification from './spec.json' with { type: 'json' }
import { implementQuery } from '@specter-ts/core'

export const todoSqlCheersState = sqliteTable('todo_sql_cheers', {
  milestone: integer('milestone').primaryKey(),
  message: text('message').notNull(),
})

export type TodoSqlCheer = typeof todoSqlCheersState.$inferSelect
export type TodoSqlCheersState = { latestCheer: TodoSqlCheer | null }

export const todoCheers = implementQuery(specification)
  .inputSchema(z.object({}))
  .outputSchema(
    z.object({
      latestCheer: z
        .object({
          milestone: z.number().int().positive(),
          message: z.string(),
        })
        .nullable(),
    }),
  )
  .store(sqliteSliceStore)
  .apply(todoCheerCreatedEvent, async (event, db) => {
    await db
      .insert(todoSqlCheersState)
      .values({
        milestone: event.payload.milestone,
        message: event.payload.message,
      })
      .onConflictDoNothing()
      .run()
  })
  .handle(async (_query, db) => {
    const latestCheers = await db
      .select()
      .from(todoSqlCheersState)
      .orderBy(desc(todoSqlCheersState.milestone))
      .limit(1)
      .all()
    return { latestCheer: latestCheers[0] ?? null } satisfies TodoSqlCheersState
  })

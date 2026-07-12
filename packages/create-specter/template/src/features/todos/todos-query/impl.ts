import { and, eq } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'

import { sqliteSliceStore } from '../../../db/specter-sqlite'
import {
  todoAddedEvent,
  todoCompletionChangedEvent,
  todoRemovedEvent,
} from '../events'
import todosQuerySpec from './spec'

export const todoSqlListItems = sqliteTable('todo_sql_list_items', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  completed: integer('completed', { mode: 'boolean' }).notNull().default(false),
  removed: integer('removed', { mode: 'boolean' }).default(false),
})

export type TodoSqlListItem = typeof todoSqlListItems.$inferSelect

const todoOutputSchema = z.array(
  z.object({
    id: z.string(),
    title: z.string(),
    completed: z.boolean(),
    removed: z.boolean().nullable(),
  }),
)

const todosQuery = todosQuerySpec
  .inputSchema(
    z.object({
      status: z.enum(['all', 'active', 'completed']).catch('all'),
    }),
  )
  .outputSchema(todoOutputSchema)
  .store(sqliteSliceStore)
  .apply(todoAddedEvent, async (event, db) => {
    await db
      .insert(todoSqlListItems)
      .values({
        id: event.payload.todoId,
        title: event.payload.title,
        completed: false,
      })
      .run()
  })
  .apply(todoCompletionChangedEvent, async (event, db) => {
    await db
      .update(todoSqlListItems)
      .set({ completed: event.payload.completed })
      .where(eq(todoSqlListItems.id, event.payload.todoId))
      .run()
  })
  .apply(todoRemovedEvent, async (event, db) => {
    await db
      .update(todoSqlListItems)
      .set({ removed: true })
      .where(eq(todoSqlListItems.id, event.payload.todoId))
      .run()
  })
  .handle(async (query, db) => {
    const visiblePredicate = eq(todoSqlListItems.removed, false)
    const statusPredicate =
      query.status === 'active'
        ? and(visiblePredicate, eq(todoSqlListItems.completed, false))
        : query.status === 'completed'
          ? and(visiblePredicate, eq(todoSqlListItems.completed, true))
          : visiblePredicate
    return await db.select().from(todoSqlListItems).where(statusPredicate).all()
  })

export default todosQuery

import { eq } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'

import { sqliteSliceStore } from '../../../db/specter-sqlite'
import { todoAddedEvent, todoRemovedEvent } from '../events'
import { removeTodoSpec } from './spec'

export const todoRemovalSqlStates = sqliteTable('todo_removal_sql_states', {
  todoId: text('todo_id').primaryKey(),
  removed: integer('removed', { mode: 'boolean' }).notNull().default(false),
})

export const removeTodo = removeTodoSpec
  .inputSchema(z.object({ todoId: z.string().min(1) }))
  .store(sqliteSliceStore)
  .apply(todoAddedEvent, async (event, db) => {
    await db
      .insert(todoRemovalSqlStates)
      .values({ todoId: event.payload.todoId })
      .onConflictDoNothing()
      .run()
  })
  .apply(todoRemovedEvent, async (event, db) => {
    await db
      .update(todoRemovalSqlStates)
      .set({ removed: true })
      .where(eq(todoRemovalSqlStates.todoId, event.payload.todoId))
      .run()
  })
  .handle(async (command, db) => {
    const rows = await db
      .select()
      .from(todoRemovalSqlStates)
      .where(eq(todoRemovalSqlStates.todoId, command.todoId))
      .all()

    if (!rows[0] || rows[0].removed) throw new Error('Todo not found')
    return [todoRemovedEvent.create({ todoId: command.todoId })]
  })

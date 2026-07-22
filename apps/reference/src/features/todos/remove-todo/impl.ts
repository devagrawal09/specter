import { eq } from 'drizzle-orm'
import { sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'

import { sqliteSliceStore } from '../../../db/specter-store'
import { todoAddedEvent, todoRemovedEvent } from '../events'
import specification from './spec.json' with { type: 'json' }
import { implementCommand } from '@specter-ts/core'

export const todoRemovalSqlStates = sqliteTable('todo_removal_sql_states', {
  todoId: text('todo_id').primaryKey(),
})

export const removeTodo = implementCommand(specification)
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
      .delete(todoRemovalSqlStates)
      .where(eq(todoRemovalSqlStates.todoId, event.payload.todoId))
      .run()
  })
  .handle(async (command, db) => {
    const rows = await db
      .select()
      .from(todoRemovalSqlStates)
      .where(eq(todoRemovalSqlStates.todoId, command.todoId))
      .all()

    if (!rows[0]) throw new Error('Todo not found')
    return [todoRemovedEvent.create({ todoId: command.todoId })]
  })

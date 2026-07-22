import { eq } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'

import { sqliteSliceStore } from '../../../db/specter-sqlite'
import {
  todoAddedEvent,
  todoCompletionChangedEvent,
  todoRemovedEvent,
} from '../events'
import specification from './spec.json' with { type: 'json' }
import { implementCommand } from '@specter-ts/core'

export const todoCompletionSqlStates = sqliteTable(
  'todo_completion_sql_states',
  {
    todoId: text('todo_id').primaryKey(),
    completed: integer('completed', { mode: 'boolean' })
      .notNull()
      .default(false),
    removed: integer('removed', { mode: 'boolean' }).notNull().default(false),
  },
)

export const changeTodoCompletion = implementCommand<'changeTodoCompletion'>(
  specification,
)
  .inputSchema(
    z.object({
      todoId: z.string().min(1),
      completed: z.boolean(),
    }),
  )
  .store(sqliteSliceStore)
  .apply(todoAddedEvent, async (event, db) => {
    await db
      .insert(todoCompletionSqlStates)
      .values({ todoId: event.payload.todoId, completed: false })
      .onConflictDoNothing()
      .run()
  })
  .apply(todoCompletionChangedEvent, async (event, db) => {
    await db
      .update(todoCompletionSqlStates)
      .set({ completed: event.payload.completed })
      .where(eq(todoCompletionSqlStates.todoId, event.payload.todoId))
      .run()
  })
  .apply(todoRemovedEvent, async (event, db) => {
    await db
      .update(todoCompletionSqlStates)
      .set({ removed: true })
      .where(eq(todoCompletionSqlStates.todoId, event.payload.todoId))
      .run()
  })
  .handle(async (command, db) => {
    const rows = await db
      .select()
      .from(todoCompletionSqlStates)
      .where(eq(todoCompletionSqlStates.todoId, command.todoId))
      .all()
    const todo = rows[0]

    if (!todo || todo.removed) throw new Error('Todo not found')
    if (todo.completed === command.completed) {
      throw new Error('Todo completion is already in requested state')
    }

    return [
      todoCompletionChangedEvent.create({
        todoId: command.todoId,
        completed: command.completed,
      }),
    ]
  })

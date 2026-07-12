import { and, eq } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'

import { sqliteSliceStore } from '../../../db/specter-sqlite'
import {
  todoAddedEvent,
  todoCheerCreatedEvent,
  todoCompletionChangedEvent,
  todoRemovedEvent,
} from '../events'
import todoCompletionCheerSpec from './spec'

export const todoCompletionCheerSqlTodoStates = sqliteTable(
  'todo_completion_cheer_sql_todo_states',
  {
    todoId: text('todo_id').primaryKey(),
    completed: integer('completed', { mode: 'boolean' })
      .notNull()
      .default(false),
    removed: integer('removed', { mode: 'boolean' }).notNull().default(false),
  },
)

export const todoCheerSqlMilestoneStates = sqliteTable(
  'todo_cheer_sql_milestone_states',
  { milestone: integer('milestone').primaryKey() },
)

const todoCompletionCheer = todoCompletionCheerSpec
  .outputSchema(
    z.object({
      type: z.literal('createTodoCheer'),
      payload: z.object({ milestone: z.number().int().positive() }),
    }),
  )
  .plugin(async (command) => async (output) => command(output))
  .store(sqliteSliceStore)
  .apply(todoAddedEvent, async (event, db) => {
    await db
      .insert(todoCompletionCheerSqlTodoStates)
      .values({
        todoId: event.payload.todoId,
        completed: false,
        removed: false,
      })
      .run()
  })
  .apply(todoCompletionChangedEvent, async (event, db) => {
    await db
      .update(todoCompletionCheerSqlTodoStates)
      .set({ completed: event.payload.completed })
      .where(eq(todoCompletionCheerSqlTodoStates.todoId, event.payload.todoId))
      .run()
  })
  .apply(todoRemovedEvent, async (event, db) => {
    await db
      .update(todoCompletionCheerSqlTodoStates)
      .set({ removed: true })
      .where(eq(todoCompletionCheerSqlTodoStates.todoId, event.payload.todoId))
      .run()
  })
  .apply(todoCheerCreatedEvent, async (event, db) => {
    await db
      .insert(todoCheerSqlMilestoneStates)
      .values({ milestone: event.payload.milestone })
      .run()
  })
  .handle(async (db) => {
    const completedTodos = await db
      .select()
      .from(todoCompletionCheerSqlTodoStates)
      .where(
        and(
          eq(todoCompletionCheerSqlTodoStates.completed, true),
          eq(todoCompletionCheerSqlTodoStates.removed, false),
        ),
      )
      .all()
    const completedCount = completedTodos.length

    if (completedCount === 0 || completedCount % 5 !== 0) return

    const existingMilestones = await db
      .select()
      .from(todoCheerSqlMilestoneStates)
      .where(eq(todoCheerSqlMilestoneStates.milestone, completedCount))
      .all()
    if (existingMilestones[0]) return

    return {
      type: 'createTodoCheer' as const,
      payload: { milestone: completedCount },
    }
  })

export default todoCompletionCheer

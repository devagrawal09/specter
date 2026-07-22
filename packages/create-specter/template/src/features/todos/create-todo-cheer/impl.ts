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
import specification from './spec.json' with { type: 'json' }
import { implementCommand } from '@specter-ts/core'

export const createTodoCheerSqlTodoStates = sqliteTable(
  'create_todo_cheer_sql_todo_states',
  {
    todoId: text('todo_id').primaryKey(),
    completed: integer('completed', { mode: 'boolean' })
      .notNull()
      .default(false),
    removed: integer('removed', { mode: 'boolean' }).notNull().default(false),
  },
)

export const createTodoCheerSqlMilestoneStates = sqliteTable(
  'create_todo_cheer_sql_milestone_states',
  { milestone: integer('milestone').primaryKey() },
)

export const createTodoCheer = implementCommand<'createTodoCheer'>(
  specification,
)
  .inputSchema(z.object({ milestone: z.number().int().positive() }))
  .store(sqliteSliceStore)
  .apply(todoAddedEvent, async (event, db) => {
    await db
      .insert(createTodoCheerSqlTodoStates)
      .values({
        todoId: event.payload.todoId,
        completed: false,
        removed: false,
      })
      .onConflictDoNothing()
      .run()
  })
  .apply(todoCompletionChangedEvent, async (event, db) => {
    await db
      .update(createTodoCheerSqlTodoStates)
      .set({ completed: event.payload.completed })
      .where(eq(createTodoCheerSqlTodoStates.todoId, event.payload.todoId))
      .run()
  })
  .apply(todoRemovedEvent, async (event, db) => {
    await db
      .update(createTodoCheerSqlTodoStates)
      .set({ removed: true })
      .where(eq(createTodoCheerSqlTodoStates.todoId, event.payload.todoId))
      .run()
  })
  .apply(todoCheerCreatedEvent, async (event, db) => {
    await db
      .insert(createTodoCheerSqlMilestoneStates)
      .values({ milestone: event.payload.milestone })
      .onConflictDoNothing()
      .run()
  })
  .handle(async (command, db) => {
    if (command.milestone % 5 !== 0) {
      throw new Error('Todo cheer milestone must be a multiple of 5')
    }

    const completedTodos = await db
      .select()
      .from(createTodoCheerSqlTodoStates)
      .where(
        and(
          eq(createTodoCheerSqlTodoStates.completed, true),
          eq(createTodoCheerSqlTodoStates.removed, false),
        ),
      )
      .all()

    if (completedTodos.length < command.milestone) {
      throw new Error('Todo cheer milestone has not been reached')
    }

    const existingMilestones = await db
      .select()
      .from(createTodoCheerSqlMilestoneStates)
      .where(eq(createTodoCheerSqlMilestoneStates.milestone, command.milestone))
      .all()
    if (existingMilestones[0])
      throw new Error('Todo cheer milestone already exists')

    return [
      todoCheerCreatedEvent.create({
        milestone: command.milestone,
        message: `Nice work: ${command.milestone} todos completed.`,
      }),
    ]
  })

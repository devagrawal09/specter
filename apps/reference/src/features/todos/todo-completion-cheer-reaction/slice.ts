import { and, eq } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { createReactionSlice } from '@specter-ts/core'
import { sqliteSliceStore } from '../../../db/specter-sqlite'
import {
  todoAddedEvent,
  todoCheerCreatedEvent,
  todoCompletionChangedEvent,
  todoRemovedEvent,
} from '../events'

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
  {
    milestone: integer('milestone').primaryKey(),
  },
)

function completedTodoEvents(count: number): unknown[] {
  return Array.from({ length: count }, (_, index) => {
    const todoId = `todo-${index + 1}`

    return [
      todoAddedEvent.create({ todoId, title: todoId }),
      todoCompletionChangedEvent.create({ todoId, completed: true }),
    ]
  }).flat()
}

const todoCompletionCheer = createReactionSlice('todoCompletionCheer')
  .plugin(async (command) => async (payload) => command(payload as never))
  .store(sqliteSliceStore)
  .scenarios(
    {
      given: [
        ...completedTodoEvents(4),
        todoCompletionChangedEvent.create({
          todoId: 'todo-4',
          completed: true,
        }),
      ],
      expect: [],
    },
    {
      given: [
        ...completedTodoEvents(5),
        todoCompletionChangedEvent.create({
          todoId: 'todo-5',
          completed: true,
        }),
      ],
      expect: [{ type: 'createTodoCheer', payload: { milestone: 5 } }],
    },
    {
      given: [
        ...completedTodoEvents(5),
        todoCheerCreatedEvent.create({
          milestone: 5,
          message: 'Nice work: 5 todos completed.',
        }),
        todoCompletionChangedEvent.create({
          todoId: 'todo-5',
          completed: false,
        }),
        todoCompletionChangedEvent.create({
          todoId: 'todo-5',
          completed: true,
        }),
        todoCompletionChangedEvent.create({
          todoId: 'todo-5',
          completed: true,
        }),
      ],
      expect: [],
    },
    {
      given: [
        ...completedTodoEvents(5),
        todoCheerCreatedEvent.create({
          milestone: 5,
          message: 'Nice work: 5 todos completed.',
        }),
        todoRemovedEvent.create({ todoId: 'todo-5' }),
        todoCompletionChangedEvent.create({
          todoId: 'todo-4',
          completed: true,
        }),
      ],
      expect: [],
    },
  )
  .apply({
    [todoAddedEvent.type]: async (event, input) => {
      const db = input
      const payload = await todoAddedEvent.decode(event.payload)

      await db
        .insert(todoCompletionCheerSqlTodoStates)
        .values({
          todoId: payload.todoId,
          completed: false,
          removed: false,
        })
        .run()
    },
    [todoCompletionChangedEvent.type]: async (event, input) => {
      const db = input
      const payload = await todoCompletionChangedEvent.decode(event.payload)

      await db
        .update(todoCompletionCheerSqlTodoStates)
        .set({ completed: payload.completed })
        .where(eq(todoCompletionCheerSqlTodoStates.todoId, payload.todoId))
        .run()
    },
    [todoRemovedEvent.type]: async (event, input) => {
      const db = input
      const payload = await todoRemovedEvent.decode(event.payload)

      await db
        .update(todoCompletionCheerSqlTodoStates)
        .set({ removed: true })
        .where(eq(todoCompletionCheerSqlTodoStates.todoId, payload.todoId))
        .run()
    },
    [todoCheerCreatedEvent.type]: async (event, input) => {
      const db = input
      const payload = await todoCheerCreatedEvent.decode(event.payload)

      await db
        .insert(todoCheerSqlMilestoneStates)
        .values({ milestone: payload.milestone })
        .run()
    },
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

    if (completedCount === 0 || completedCount % 5 !== 0) {
      return
    }

    const existingMilestones = await db
      .select()
      .from(todoCheerSqlMilestoneStates)
      .where(eq(todoCheerSqlMilestoneStates.milestone, completedCount))
      .all()

    if (existingMilestones[0]) {
      return
    }

    return {
      type: 'createTodoCheer',
      payload: { milestone: completedCount },
    }
  })

export default todoCompletionCheer

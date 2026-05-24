import { and, eq } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { Effect } from 'effect'
import { createReactionSpec } from '../../../lib2/builders'
import {
  todoAddedEvent,
  todoCheerCreatedEvent,
  todoCompletionChangedEvent,
  todoRemovedEvent,
} from '../../todos-json/events'

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

const todoCompletionCheerSql = createReactionSpec('todoCompletionCheer')
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
    [todoAddedEvent.type]: (event, input) =>
      Effect.gen(function* () {
        const db = input
        const payload = event.payload as { todoId: string }

        yield* db.insert(todoCompletionCheerSqlTodoStates).values({
          todoId: payload.todoId,
          completed: false,
          removed: false,
        })
      }),
    [todoCompletionChangedEvent.type]: (event, input) =>
      Effect.gen(function* () {
        const db = input
        const payload = event.payload as { todoId: string; completed: boolean }

        yield* db
          .update(todoCompletionCheerSqlTodoStates)
          .set({ completed: payload.completed })
          .where(eq(todoCompletionCheerSqlTodoStates.todoId, payload.todoId))
      }),
    [todoRemovedEvent.type]: (event, input) =>
      Effect.gen(function* () {
        const db = input
        const payload = event.payload as { todoId: string }

        yield* db
          .update(todoCompletionCheerSqlTodoStates)
          .set({ removed: true })
          .where(eq(todoCompletionCheerSqlTodoStates.todoId, payload.todoId))
      }),
    [todoCheerCreatedEvent.type]: (event, input) =>
      Effect.gen(function* () {
        const db = input
        const payload = event.payload as { milestone: number }

        yield* db
          .insert(todoCheerSqlMilestoneStates)
          .values({ milestone: payload.milestone })
      }),
  })
  .handle((input) =>
    Effect.gen(function* () {
      const db = input
      const completedTodos = yield* db
        .select()
        .from(todoCompletionCheerSqlTodoStates)
        .where(
          and(
            eq(todoCompletionCheerSqlTodoStates.completed, true),
            eq(todoCompletionCheerSqlTodoStates.removed, false),
          ),
        )
      const completedCount = completedTodos.length

      if (completedCount === 0 || completedCount % 5 !== 0) {
        return
      }

      const existingMilestones = yield* db
        .select()
        .from(todoCheerSqlMilestoneStates)
        .where(eq(todoCheerSqlMilestoneStates.milestone, completedCount))

      if (existingMilestones[0]) {
        return
      }

      return {
        type: 'createTodoCheer',
        payload: { milestone: completedCount },
      }
    }),
  )

export default todoCompletionCheerSql

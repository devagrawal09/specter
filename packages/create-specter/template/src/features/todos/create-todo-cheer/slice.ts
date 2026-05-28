import { and, eq } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { Effect } from 'effect'
import * as Schema from 'effect/Schema'
import { createCommandSlice, rejectCommand } from '@specter-ts/core'
import {
  todoAddedEvent,
  todoCheerCreatedEvent,
  todoCompletionChangedEvent,
  todoRemovedEvent,
} from '../events'

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
  {
    milestone: integer('milestone').primaryKey(),
  },
)

function completedTodoEvents(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const todoId = `todo-${index + 1}`

    return [
      todoAddedEvent.create({ todoId, title: todoId }),
      todoCompletionChangedEvent.create({ todoId, completed: true }),
    ]
  }).flat()
}

const createTodoCheerSql = createCommandSlice('createTodoCheer')
  .schema(
    Schema.Struct({
      milestone: Schema.Number.pipe(Schema.int(), Schema.positive()),
    }),
  )
  .scenarios(
    {
      given: [],
      when: { milestone: 4 },
      expect: [],
    },
    {
      given: completedTodoEvents(4),
      when: { milestone: 5 },
      expect: [],
    },
    {
      given: [
        ...completedTodoEvents(5),
        todoCheerCreatedEvent.create({
          milestone: 5,
          message: 'Nice work: 5 todos completed.',
        }),
      ],
      when: { milestone: 5 },
      expect: [],
    },
    {
      given: completedTodoEvents(5),
      when: { milestone: 5 },
      expect: [
        todoCheerCreatedEvent.create({
          milestone: 5,
          message: 'Nice work: 5 todos completed.',
        }),
      ],
    },
    {
      given: [
        ...completedTodoEvents(5),
        todoRemovedEvent.create({ todoId: 'todo-5' }),
      ],
      when: { milestone: 5 },
      expect: [],
    },
  )
  .apply({
    [todoAddedEvent.type]: (event, input) =>
      Effect.gen(function* () {
        const db = input
        const payload = todoAddedEvent.decode(event.payload)

        yield* db.insert(createTodoCheerSqlTodoStates).values({
          todoId: payload.todoId,
          completed: false,
          removed: false,
        })
      }),
    [todoCompletionChangedEvent.type]: (event, input) =>
      Effect.gen(function* () {
        const db = input
        const payload = todoCompletionChangedEvent.decode(event.payload)

        yield* db
          .update(createTodoCheerSqlTodoStates)
          .set({ completed: payload.completed })
          .where(eq(createTodoCheerSqlTodoStates.todoId, payload.todoId))
      }),
    [todoRemovedEvent.type]: (event, input) =>
      Effect.gen(function* () {
        const db = input
        const payload = todoRemovedEvent.decode(event.payload)

        yield* db
          .update(createTodoCheerSqlTodoStates)
          .set({ removed: true })
          .where(eq(createTodoCheerSqlTodoStates.todoId, payload.todoId))
      }),
    [todoCheerCreatedEvent.type]: (event, input) =>
      Effect.gen(function* () {
        const db = input
        const payload = todoCheerCreatedEvent.decode(event.payload)

        yield* db
          .insert(createTodoCheerSqlMilestoneStates)
          .values({ milestone: payload.milestone })
      }),
  })
  .handle((db, command) =>
    Effect.gen(function* () {
      if (command.milestone % 5 !== 0) {
        return yield* rejectCommand(
          'Todo cheer milestone must be a multiple of 5',
        )
      }

      const completedTodos = yield* db
        .select()
        .from(createTodoCheerSqlTodoStates)
        .where(
          and(
            eq(createTodoCheerSqlTodoStates.completed, true),
            eq(createTodoCheerSqlTodoStates.removed, false),
          ),
        )
      const completedCount = completedTodos.length

      if (completedCount < command.milestone) {
        return yield* rejectCommand('Todo cheer milestone has not been reached')
      }

      const existingMilestones = yield* db
        .select()
        .from(createTodoCheerSqlMilestoneStates)
        .where(
          eq(createTodoCheerSqlMilestoneStates.milestone, command.milestone),
        )

      if (existingMilestones[0]) {
        return yield* rejectCommand('Todo cheer milestone already exists')
      }

      return [
        todoCheerCreatedEvent.create({
          milestone: command.milestone,
          message: `Nice work: ${command.milestone} todos completed.`,
        }),
      ]
    }),
  )

export default createTodoCheerSql

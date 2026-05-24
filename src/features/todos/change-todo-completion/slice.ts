import { eq } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { Effect } from 'effect'
import * as Schema from 'effect/Schema'
import { createCommandSpec } from '../../../lib2/builders'
import {
  errorEvent,
  todoAddedEvent,
  todoCompletionChangedEvent,
  todoRemovedEvent,
} from '../events'

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

const changeTodoCompletionSql = createCommandSpec('changeTodoCompletion')
  .schema(
    Schema.Struct({
      todoId: Schema.String.pipe(Schema.minLength(1)),
      completed: Schema.Boolean,
    }),
  )
  .scenarios(
    {
      given: [todoAddedEvent.create({ todoId: 'todo-1', title: 'Ship it' })],
      when: { todoId: 'todo-1', completed: true },
      expect: [
        todoCompletionChangedEvent.create({
          todoId: 'todo-1',
          completed: true,
        }),
      ],
    },
    {
      given: [
        todoAddedEvent.create({ todoId: 'todo-1', title: 'Ship it' }),
        todoCompletionChangedEvent.create({
          todoId: 'todo-1',
          completed: true,
        }),
      ],
      when: { todoId: 'todo-1', completed: true },
      expect: [],
    },
    {
      given: [],
      when: { todoId: 'missing', completed: true },
      expect: [errorEvent.create({ message: 'Todo not found' })],
    },
    {
      given: [
        todoAddedEvent.create({ todoId: 'todo-1', title: 'Ship it' }),
        todoRemovedEvent.create({ todoId: 'todo-1' }),
      ],
      when: { todoId: 'todo-1', completed: true },
      expect: [errorEvent.create({ message: 'Todo not found' })],
    },
  )
  .apply({
    [todoAddedEvent.type]: (event, input) =>
      Effect.gen(function* () {
        const db = input
        const payload = event.payload as { todoId: string }

        yield* db.insert(todoCompletionSqlStates).values({
          todoId: payload.todoId,
          completed: false,
        })
      }),
    [todoCompletionChangedEvent.type]: (event, input) =>
      Effect.gen(function* () {
        const db = input
        const payload = event.payload as { todoId: string; completed: boolean }

        yield* db
          .update(todoCompletionSqlStates)
          .set({ completed: payload.completed })
          .where(eq(todoCompletionSqlStates.todoId, payload.todoId))
      }),
    [todoRemovedEvent.type]: (event, input) =>
      Effect.gen(function* () {
        const db = input
        const payload = event.payload as { todoId: string }

        yield* db
          .update(todoCompletionSqlStates)
          .set({ removed: true })
          .where(eq(todoCompletionSqlStates.todoId, payload.todoId))
      }),
  })
  .handle((input, command) =>
    Effect.gen(function* () {
      const db = input
      const rows = yield* db
        .select()
        .from(todoCompletionSqlStates)
        .where(eq(todoCompletionSqlStates.todoId, command.todoId))
      const todo = rows[0]

      if (!todo || todo.removed) {
        return [errorEvent.create({ message: 'Todo not found' })]
      }

      if (todo.completed === command.completed) {
        return []
      }

      return [
        todoCompletionChangedEvent.create({
          todoId: command.todoId,
          completed: command.completed,
        }),
      ]
    }),
  )

export default changeTodoCompletionSql

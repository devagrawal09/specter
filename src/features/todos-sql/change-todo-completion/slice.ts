import { eq } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { Effect } from 'effect'
import { z } from 'zod'
import { createCommandSpec } from '../../../lib2'
import {
  errorEvent,
  todoAddedEvent,
  todoCompletionChangedEvent,
  todoRemovedEvent,
} from '../../todos-json/events'

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

export const changeTodoCompletionSql = createCommandSpec('changeTodoCompletion')
  .schema(
    z.object({
      todoId: z.string().min(1, 'Todo id is required'),
      completed: z.boolean(),
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

import { eq } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { Effect } from 'effect'
import { z } from 'zod'
import { createCommandSpec } from '../../../lib2'
import {
  errorEvent,
  todoAddedEvent,
  todoRemovedEvent,
} from '../../todos-json/events'

export const todoRemovalSqlStates = sqliteTable('todo_removal_sql_states', {
  todoId: text('todo_id').primaryKey(),
  removed: integer('removed', { mode: 'boolean' }).notNull().default(false),
})

export const removeTodoSql = createCommandSpec('removeTodo')
  .schema(
    z.object({
      todoId: z.string().min(1, 'Todo id is required'),
    }),
  )
  .scenarios(
    {
      given: [todoAddedEvent.create({ todoId: 'todo-1', title: 'Ship it' })],
      when: { todoId: 'todo-1' },
      expect: [todoRemovedEvent.create({ todoId: 'todo-1' })],
    },
    {
      given: [],
      when: { todoId: 'missing' },
      expect: [errorEvent.create({ message: 'Todo not found' })],
    },
    {
      given: [
        todoAddedEvent.create({ todoId: 'todo-1', title: 'Ship it' }),
        todoRemovedEvent.create({ todoId: 'todo-1' }),
      ],
      when: { todoId: 'todo-1' },
      expect: [errorEvent.create({ message: 'Todo not found' })],
    },
  )
  .apply({
    [todoAddedEvent.type]: (event, input) =>
      Effect.gen(function* () {
        const db = input
        const payload = event.payload as { todoId: string }

        yield* db
          .insert(todoRemovalSqlStates)
          .values({ todoId: payload.todoId })
      }),
    [todoRemovedEvent.type]: (event, input) =>
      Effect.gen(function* () {
        const db = input
        const payload = event.payload as { todoId: string }

        yield* db
          .update(todoRemovalSqlStates)
          .set({ removed: true })
          .where(eq(todoRemovalSqlStates.todoId, payload.todoId))
      }),
  })
  .handle((input, command) =>
    Effect.gen(function* () {
      const db = input
      const rows = yield* db
        .select()
        .from(todoRemovalSqlStates)
        .where(eq(todoRemovalSqlStates.todoId, command.todoId))
      const todo = rows[0]

      if (!todo || todo.removed) {
        return [errorEvent.create({ message: 'Todo not found' })]
      }

      return [todoRemovedEvent.create({ todoId: command.todoId })]
    }),
  )

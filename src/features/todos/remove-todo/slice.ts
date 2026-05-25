import { eq } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { Effect } from 'effect'
import * as Schema from 'effect/Schema'
import { createCommandSlice, rejectCommand } from '../../../lib'
import { todoAddedEvent, todoRemovedEvent } from '../events'

export const todoRemovalSqlStates = sqliteTable('todo_removal_sql_states', {
  todoId: text('todo_id').primaryKey(),
  removed: integer('removed', { mode: 'boolean' }).notNull().default(false),
})

const removeTodoSql = createCommandSlice('removeTodo')
  .schema(
    Schema.Struct({
      todoId: Schema.String.pipe(Schema.minLength(1)),
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
      expect: [],
    },
    {
      given: [
        todoAddedEvent.create({ todoId: 'todo-1', title: 'Ship it' }),
        todoRemovedEvent.create({ todoId: 'todo-1' }),
      ],
      when: { todoId: 'todo-1' },
      expect: [],
    },
  )
  .apply({
    [todoAddedEvent.type]: (event, input) =>
      Effect.gen(function* () {
        const db = input
        const payload = todoAddedEvent.decode(event.payload)

        yield* db
          .insert(todoRemovalSqlStates)
          .values({ todoId: payload.todoId })
      }),
    [todoRemovedEvent.type]: (event, input) =>
      Effect.gen(function* () {
        const db = input
        const payload = todoRemovedEvent.decode(event.payload)

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
        return yield* rejectCommand('Todo not found')
      }

      return [todoRemovedEvent.create({ todoId: command.todoId })]
    }),
  )

export default removeTodoSql

import { eq } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import * as Schema from 'effect/Schema'
import { createCommandSlice, rejectCommand } from '@specter-ts/core'
import { runSql, selectSql, sqliteSliceStore } from '../../../specter-sqlite'
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
  .store(sqliteSliceStore)
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
    [todoAddedEvent.type]: async (event, input) => {
      const db = input
      const payload = todoAddedEvent.decode(event.payload)

      runSql(db.insert(todoRemovalSqlStates).values({ todoId: payload.todoId }))
    },
    [todoRemovedEvent.type]: async (event, input) => {
      const db = input
      const payload = todoRemovedEvent.decode(event.payload)

      runSql(
        db
          .update(todoRemovalSqlStates)
          .set({ removed: true })
          .where(eq(todoRemovalSqlStates.todoId, payload.todoId)),
      )
    },
  })
  .handle(async (command, db) => {
    const rows = selectSql(
      db
        .select()
        .from(todoRemovalSqlStates)
        .where(eq(todoRemovalSqlStates.todoId, command.todoId)),
    )
    const todo = rows[0]

    if (!todo || todo.removed) {
      rejectCommand('Todo not found')
    }

    return [todoRemovedEvent.create({ todoId: command.todoId })]
  })

export default removeTodoSql

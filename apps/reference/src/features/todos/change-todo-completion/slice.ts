import { eq } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import * as Schema from 'effect/Schema'
import { createCommandSlice, rejectCommand } from '@specter-ts/core'
import { sqliteSliceStore } from '../../../db/specter-sqlite'
import {
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

const changeTodoCompletionSql = createCommandSlice('changeTodoCompletion')
  .schema(
    Schema.Struct({
      todoId: Schema.String.pipe(Schema.minLength(1)),
      completed: Schema.Boolean,
    }),
  )
  .store(sqliteSliceStore)
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
      expect: [],
    },
    {
      given: [
        todoAddedEvent.create({ todoId: 'todo-1', title: 'Ship it' }),
        todoRemovedEvent.create({ todoId: 'todo-1' }),
      ],
      when: { todoId: 'todo-1', completed: true },
      expect: [],
    },
  )
  .apply({
    [todoAddedEvent.type]: async (event, input) => {
      const db = input
      const payload = todoAddedEvent.decode(event.payload)

      db.insert(todoCompletionSqlStates)
        .values({
          todoId: payload.todoId,
          completed: false,
        })
        .run()
    },
    [todoCompletionChangedEvent.type]: async (event, input) => {
      const db = input
      const payload = todoCompletionChangedEvent.decode(event.payload)

      db.update(todoCompletionSqlStates)
        .set({ completed: payload.completed })
        .where(eq(todoCompletionSqlStates.todoId, payload.todoId))
        .run()
    },
    [todoRemovedEvent.type]: async (event, input) => {
      const db = input
      const payload = todoRemovedEvent.decode(event.payload)

      db.update(todoCompletionSqlStates)
        .set({ removed: true })
        .where(eq(todoCompletionSqlStates.todoId, payload.todoId))
        .run()
    },
  })
  .handle(async (command, db) => {
    const rows = db
      .select()
      .from(todoCompletionSqlStates)
      .where(eq(todoCompletionSqlStates.todoId, command.todoId))
      .all()
    const todo = rows[0]

    if (!todo || todo.removed) {
      rejectCommand('Todo not found')
    }

    if (todo.completed === command.completed) {
      rejectCommand('Todo completion is already in requested state')
    }

    return [
      todoCompletionChangedEvent.create({
        todoId: command.todoId,
        completed: command.completed,
      }),
    ]
  })

export default changeTodoCompletionSql

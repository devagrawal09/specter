import { eq } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'
import { createCommandSpec } from '../../../lib/registry.builders'
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
    [todoAddedEvent.type]: (event, tx) => {
      tx.insert(todoCompletionSqlStates)
        .values({
          todoId: event.payload.todoId,
          completed: false,
        })
        .run()
    },
    [todoCompletionChangedEvent.type]: (event, tx) => {
      tx.update(todoCompletionSqlStates)
        .set({ completed: event.payload.completed })
        .where(eq(todoCompletionSqlStates.todoId, event.payload.todoId))
        .run()
    },
    [todoRemovedEvent.type]: (event, tx) => {
      tx.update(todoCompletionSqlStates)
        .set({ removed: true })
        .where(eq(todoCompletionSqlStates.todoId, event.payload.todoId))
        .run()
    },
  })
  .decide((command, tx) => {
    const todo = tx
      .select()
      .from(todoCompletionSqlStates)
      .where(eq(todoCompletionSqlStates.todoId, command.todoId))
      .get()

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
  })

import { eq } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'
import { createCommandSpec } from '../../lib/registry.builders'
import {
  errorEvent,
  todoAddedEvent,
  todoCompletionChangedEvent,
  todoRemovedEvent,
} from '../events'

export const todoCompletionStates = sqliteTable('todo_completion_states', {
  todoId: text('todo_id').primaryKey(),
  completed: integer('completed', { mode: 'boolean' }).notNull().default(false),
  removed: integer('removed', { mode: 'boolean' }).notNull().default(false),
})

export const changeTodoCompletion = createCommandSpec('changeTodoCompletion')
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
      tx.insert(todoCompletionStates)
        .values({
          todoId: event.payload.todoId,
          completed: false,
        })
        .run()
    },
    [todoCompletionChangedEvent.type]: (event, tx) => {
      tx.update(todoCompletionStates)
        .set({
          completed: event.payload.completed,
        })
        .where(eq(todoCompletionStates.todoId, event.payload.todoId))
        .run()
    },
    [todoRemovedEvent.type]: (event, tx) => {
      tx.update(todoCompletionStates)
        .set({
          removed: true,
        })
        .where(eq(todoCompletionStates.todoId, event.payload.todoId))
        .run()
    },
  })
  .decide((command, tx) => {
    const todo = tx
      .select()
      .from(todoCompletionStates)
      .where(eq(todoCompletionStates.todoId, command.todoId))
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

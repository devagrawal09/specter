import { eq } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'
import { createCommandSpec } from '../../../lib_legacy/registry.builders'
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
    [todoAddedEvent.type]: (event, tx) => {
      tx.insert(todoRemovalSqlStates)
        .values({ todoId: event.payload.todoId })
        .run()
    },
    [todoRemovedEvent.type]: (event, tx) => {
      tx.update(todoRemovalSqlStates)
        .set({ removed: true })
        .where(eq(todoRemovalSqlStates.todoId, event.payload.todoId))
        .run()
    },
  })
  .decide((command, tx) => {
    const todo = tx
      .select()
      .from(todoRemovalSqlStates)
      .where(eq(todoRemovalSqlStates.todoId, command.todoId))
      .get()

    if (!todo || todo.removed) {
      return [errorEvent.create({ message: 'Todo not found' })]
    }

    return [todoRemovedEvent.create({ todoId: command.todoId })]
  })

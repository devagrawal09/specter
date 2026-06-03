import { eq } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'
import { createCommandSlice } from '@specter-ts/core'
import { sqliteSliceStore } from '../../../db/specter-sqlite'
import { todoAddedEvent, todoRemovedEvent } from '../events'

export const todoRemovalSqlStates = sqliteTable('todo_removal_sql_states', {
  todoId: text('todo_id').primaryKey(),
  removed: integer('removed', { mode: 'boolean' }).notNull().default(false),
})

const removeTodoSql = createCommandSlice(
  'removeTodo',
  'Removes an existing todo.',
)
  .schema(
    z.object({
      todoId: z.string().min(1),
    }),
  )
  .store(sqliteSliceStore)
  .scenarios(
    {
      description: 'Removes an active todo.',
      given: [todoAddedEvent.create({ todoId: 'todo-1', title: 'Ship it' })],
      when: { todoId: 'todo-1' },
      expect: [todoRemovedEvent.create({ todoId: 'todo-1' })],
    },
    {
      description: 'Rejects removing a missing todo.',
      given: [],
      when: { todoId: 'missing' },
      expect: [],
    },
    {
      description: 'Rejects removing a todo twice.',
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
      const payload = await todoAddedEvent.decode(event.payload)

      await db
        .insert(todoRemovalSqlStates)
        .values({ todoId: payload.todoId })
        .run()
    },
    [todoRemovedEvent.type]: async (event, input) => {
      const db = input
      const payload = await todoRemovedEvent.decode(event.payload)

      await db
        .update(todoRemovalSqlStates)
        .set({ removed: true })
        .where(eq(todoRemovalSqlStates.todoId, payload.todoId))
        .run()
    },
  })
  .handle(async (command, db) => {
    const rows = await db
      .select()
      .from(todoRemovalSqlStates)
      .where(eq(todoRemovalSqlStates.todoId, command.todoId))
      .all()
    const todo = rows[0]

    if (!todo || todo.removed) {
      throw new Error('Todo not found')
    }

    return [todoRemovedEvent.create({ todoId: command.todoId })]
  })

export default removeTodoSql

import { eq } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'
import { createCommandSlice } from '../../registry.builders'
import { todoAddedEvent, todoRemovedEvent } from '../../shared'

export const todoRemovalStates = sqliteTable('todo_removal_states', {
  todoId: text('todo_id').primaryKey(),
  removed: integer('removed', { mode: 'boolean' }).notNull().default(false),
  lastAppliedEventId: integer('last_applied_event_id').notNull(),
})

export const removeTodoSliceRegistration = createCommandSlice('removeTodo')
  .schema(
    z.object({
      todoId: z.string().min(1, 'Todo id is required'),
    }),
  )
  .apply((event, tx) => {
    if (todoAddedEvent.is(event)) {
      tx.insert(todoRemovalStates)
        .values({
          todoId: event.payload.todoId,
          lastAppliedEventId: event.id,
        })
        .run()
    }

    if (todoRemovedEvent.is(event)) {
      tx.update(todoRemovalStates)
        .set({
          removed: true,
          lastAppliedEventId: event.id,
        })
        .where(eq(todoRemovalStates.todoId, event.payload.todoId))
        .run()
    }
  })
  .decide((command, tx) => {
    const todo = tx
      .select()
      .from(todoRemovalStates)
      .where(eq(todoRemovalStates.todoId, command.todoId))
      .get()

    if (!todo || todo.removed) {
      throw new Error('Todo not found')
    }

    return [todoRemovedEvent.create({ todoId: command.todoId })]
  })

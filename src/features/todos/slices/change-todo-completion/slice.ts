import { eq } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'
import { createCommandSlice } from '../../registry.builders'
import {
  todoAddedEvent,
  todoCompletionChangedEvent,
  todoRemovedEvent,
} from '../../shared'

export const todoCompletionStates = sqliteTable('todo_completion_states', {
  todoId: text('todo_id').primaryKey(),
  completed: integer('completed', { mode: 'boolean' }).notNull().default(false),
  removed: integer('removed', { mode: 'boolean' }).notNull().default(false),
  lastAppliedEventId: text('last_applied_event_id').notNull(),
})

const changeTodoCompletionInput = z.object({
  todoId: z.string().min(1, 'Todo id is required'),
  completed: z.boolean(),
})

export const changeTodoCompletionSliceRegistration = createCommandSlice(
  'changeTodoCompletion',
)
  .schema(changeTodoCompletionInput)
  .apply((event, tx) => {
    if (todoAddedEvent.is(event)) {
      tx.insert(todoCompletionStates)
        .values({
          todoId: event.payload.todoId,
          completed: false,
          lastAppliedEventId: event.id,
        })
        .run()
    }

    if (todoCompletionChangedEvent.is(event)) {
      tx.update(todoCompletionStates)
        .set({
          completed: event.payload.completed,
          lastAppliedEventId: event.id,
        })
        .where(eq(todoCompletionStates.todoId, event.payload.todoId))
        .run()
    }

    if (todoRemovedEvent.is(event)) {
      tx.update(todoCompletionStates)
        .set({
          removed: true,
          lastAppliedEventId: event.id,
        })
        .where(eq(todoCompletionStates.todoId, event.payload.todoId))
        .run()
    }
  })
  .decide((command, tx) => {
    const todo = tx
      .select()
      .from(todoCompletionStates)
      .where(eq(todoCompletionStates.todoId, command.todoId))
      .get()

    if (!todo || todo.removed) {
      throw new Error('Todo not found')
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

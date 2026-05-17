import { eq } from 'drizzle-orm'
import { createCommandSlice } from '../../registry.builders'
import { changeTodoCompletionInput, todoCompletionStates } from './schema'

export const changeTodoCompletionSliceRegistration = createCommandSlice(
  'changeTodoCompletion',
)
  .schema(changeTodoCompletionInput)
  .applyEvents((tx, events) => {
    for (const event of events) {
      if (event.type === 'todoAdded') {
        tx.insert(todoCompletionStates)
          .values({
            todoId: event.payload.todoId,
            completed: false,
            lastAppliedEventId: event.id,
          })
          .run()
      }

      if (event.type === 'todoCompletionChanged') {
        tx.update(todoCompletionStates)
          .set({
            completed: event.payload.completed,
            lastAppliedEventId: event.id,
          })
          .where(eq(todoCompletionStates.todoId, event.payload.todoId))
          .run()
      }

      if (event.type === 'todoRemoved') {
        tx.update(todoCompletionStates)
          .set({
            removed: true,
            lastAppliedEventId: event.id,
          })
          .where(eq(todoCompletionStates.todoId, event.payload.todoId))
          .run()
      }
    }
  })
  .decide((tx, command) => {
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
      {
        type: 'todoCompletionChanged',
        payload: {
          todoId: command.todoId,
          completed: command.completed,
        },
      },
    ]
  })

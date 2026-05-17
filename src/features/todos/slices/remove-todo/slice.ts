import { eq } from 'drizzle-orm'
import { createCommandSlice } from '../../registry.builders'
import { removeTodoInput, todoRemovalStates } from './schema'

export const removeTodoSliceRegistration = createCommandSlice('removeTodo')
  .schema(removeTodoInput)
  .applyEvents((tx, events) => {
    for (const event of events) {
      if (event.type === 'todoAdded') {
        tx.insert(todoRemovalStates)
          .values({
            todoId: event.payload.todoId,
            lastAppliedEventId: event.id,
          })
          .run()
      }

      if (event.type === 'todoRemoved') {
        tx.update(todoRemovalStates)
          .set({
            removed: true,
            lastAppliedEventId: event.id,
          })
          .where(eq(todoRemovalStates.todoId, event.payload.todoId))
          .run()
      }
    }
  })
  .decide((tx, command) => {
    const todo = tx
      .select()
      .from(todoRemovalStates)
      .where(eq(todoRemovalStates.todoId, command.todoId))
      .get()

    if (!todo || todo.removed) {
      throw new Error('Todo not found')
    }

    return [
      {
        type: 'todoRemoved',
        payload: { todoId: command.todoId },
      },
    ]
  })

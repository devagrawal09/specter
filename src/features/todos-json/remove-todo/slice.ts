import { z } from 'zod'
import { createCommandSpec } from '../../../lib_legacy/registry.builders'
import { errorEvent, todoAddedEvent, todoRemovedEvent } from '../events'

type TodoState = { removed: boolean }

export const removeTodo = createCommandSpec('removeTodo', { json: true })
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
    [todoAddedEvent.type]: (event, store) => {
      store.set(event.payload.todoId, { removed: false })
    },
    [todoRemovedEvent.type]: (event, store) => {
      store.patch<TodoState>(event.payload.todoId, { removed: true })
    },
  })
  .decide((command, store) => {
    const todo = store.get<TodoState>(command.todoId)

    if (!todo || todo.removed) {
      return [errorEvent.create({ message: 'Todo not found' })]
    }

    return [todoRemovedEvent.create({ todoId: command.todoId })]
  })

import { z } from 'zod'
import { createCommandSpec } from '../../../lib_legacy/registry.builders'
import {
  errorEvent,
  todoAddedEvent,
  todoCompletionChangedEvent,
  todoRemovedEvent,
} from '../events'

type TodoState = { completed: boolean; removed: boolean }

export const changeTodoCompletion = createCommandSpec('changeTodoCompletion', {
  json: true,
})
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
    [todoAddedEvent.type]: (event, store) => {
      store.set(event.payload.todoId, { completed: false, removed: false })
    },
    [todoCompletionChangedEvent.type]: (event, store) => {
      store.patch<TodoState>(event.payload.todoId, {
        completed: event.payload.completed,
      })
    },
    [todoRemovedEvent.type]: (event, store) => {
      store.patch<TodoState>(event.payload.todoId, {
        removed: true,
      })
    },
  })
  .decide((command, store) => {
    const todo = store.get<TodoState>(command.todoId)

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

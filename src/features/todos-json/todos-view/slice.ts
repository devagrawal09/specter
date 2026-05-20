import { z } from 'zod'
import { createProjectionSpec } from '../../../lib_legacy/registry.builders'
import {
  todoAddedEvent,
  todoCompletionChangedEvent,
  todoRemovedEvent,
} from '../events'

type TodoListItem = {
  id: string
  title: string
  completed: boolean
  removed: boolean
}

const itemsKey = 'items'

function todoItems(store: {
  get: <TValue>(key: string) => TValue | undefined
}) {
  return store.get<TodoListItem[]>(itemsKey) ?? []
}

export const todosProjection = createProjectionSpec('todosProjection', {
  json: true,
})
  .schema(
    z.object({
      status: z.enum(['all', 'active', 'completed']).catch('all'),
    }),
  )
  .apply({
    [todoAddedEvent.type]: (event, store) => {
      store.set(itemsKey, [
        ...todoItems(store),
        {
          id: event.payload.todoId,
          title: event.payload.title,
          completed: false,
          removed: false,
        },
      ])
    },
    [todoCompletionChangedEvent.type]: (event, store) => {
      store.set(
        itemsKey,
        todoItems(store).map((todo) =>
          todo.id === event.payload.todoId
            ? { ...todo, completed: event.payload.completed }
            : todo,
        ),
      )
    },
    [todoRemovedEvent.type]: (event, store) => {
      store.set(
        itemsKey,
        todoItems(store).map((todo) =>
          todo.id === event.payload.todoId ? { ...todo, removed: true } : todo,
        ),
      )
    },
  })
  .scenarios(
    {
      given: [],
      when: { status: 'all' },
      expect: [],
    },
    {
      given: [
        todoAddedEvent.create({ todoId: 'todo-1', title: 'Ship it' }),
        todoAddedEvent.create({ todoId: 'todo-2', title: 'Review it' }),
      ],
      when: { status: 'all' },
      expect: [
        { id: 'todo-1', title: 'Ship it', completed: false, removed: false },
        { id: 'todo-2', title: 'Review it', completed: false, removed: false },
      ],
    },
    {
      given: [
        todoAddedEvent.create({ todoId: 'todo-1', title: 'Ship it' }),
        todoCompletionChangedEvent.create({
          todoId: 'todo-1',
          completed: true,
        }),
        todoAddedEvent.create({ todoId: 'todo-2', title: 'Review it' }),
      ],
      when: { status: 'active' },
      expect: [
        { id: 'todo-2', title: 'Review it', completed: false, removed: false },
      ],
    },
    {
      given: [
        todoAddedEvent.create({ todoId: 'todo-1', title: 'Ship it' }),
        todoCompletionChangedEvent.create({
          todoId: 'todo-1',
          completed: true,
        }),
        todoAddedEvent.create({ todoId: 'todo-2', title: 'Review it' }),
      ],
      when: { status: 'completed' },
      expect: [
        { id: 'todo-1', title: 'Ship it', completed: true, removed: false },
      ],
    },
    {
      given: [
        todoAddedEvent.create({ todoId: 'todo-1', title: 'Ship it' }),
        todoRemovedEvent.create({ todoId: 'todo-1' }),
      ],
      when: { status: 'all' },
      expect: [],
    },
  )
  .query((store, input) => {
    const visibleTodos = todoItems(store).filter((todo) => !todo.removed)

    if (input.status === 'active') {
      return visibleTodos.filter((todo) => !todo.completed)
    }

    if (input.status === 'completed') {
      return visibleTodos.filter((todo) => todo.completed)
    }

    return visibleTodos
  })

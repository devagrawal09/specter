import { z } from 'zod'
import { createCommandSpec } from '../../../lib_legacy/registry.builders'
import {
  errorEvent,
  todoAddedEvent,
  todoCheerCreatedEvent,
  todoCompletionChangedEvent,
  todoRemovedEvent,
} from '../events'

type TodoCheerCommandState = {
  todos: Record<string, { completed: boolean; removed: boolean }>
  milestones: number[]
}

const stateKey = 'state'

function todoCheerCommandState(store: {
  get: <TValue>(key: string) => TValue | undefined
}) {
  return (
    store.get<TodoCheerCommandState>(stateKey) ?? { todos: {}, milestones: [] }
  )
}

function completedTodoEvents(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const todoId = `todo-${index + 1}`

    return [
      todoAddedEvent.create({ todoId, title: todoId }),
      todoCompletionChangedEvent.create({ todoId, completed: true }),
    ]
  }).flat()
}

export const createTodoCheer = createCommandSpec('createTodoCheer', {
  json: true,
})
  .schema(
    z.object({
      milestone: z.number().int().positive(),
    }),
  )
  .scenarios(
    {
      given: [],
      when: { milestone: 4 },
      expect: [
        errorEvent.create({
          message: 'Todo cheer milestone must be a multiple of 5',
        }),
      ],
    },
    {
      given: completedTodoEvents(4),
      when: { milestone: 5 },
      expect: [
        errorEvent.create({
          message: 'Todo cheer milestone has not been reached',
        }),
      ],
    },
    {
      given: [
        ...completedTodoEvents(5),
        todoCheerCreatedEvent.create({
          milestone: 5,
          message: 'Nice work: 5 todos completed.',
        }),
      ],
      when: { milestone: 5 },
      expect: [
        errorEvent.create({
          message: 'Todo cheer milestone already exists',
        }),
      ],
    },
    {
      given: completedTodoEvents(5),
      when: { milestone: 5 },
      expect: [
        todoCheerCreatedEvent.create({
          milestone: 5,
          message: 'Nice work: 5 todos completed.',
        }),
      ],
    },
    {
      given: [
        ...completedTodoEvents(5),
        todoRemovedEvent.create({ todoId: 'todo-5' }),
      ],
      when: { milestone: 5 },
      expect: [
        errorEvent.create({
          message: 'Todo cheer milestone has not been reached',
        }),
      ],
    },
  )
  .apply({
    [todoAddedEvent.type]: (event, store) => {
      const state = todoCheerCommandState(store)
      store.set(stateKey, {
        ...state,
        todos: {
          ...state.todos,
          [event.payload.todoId]: { completed: false, removed: false },
        },
      })
    },
    [todoCompletionChangedEvent.type]: (event, store) => {
      const state = todoCheerCommandState(store)
      const todo = state.todos[event.payload.todoId]

      store.set(stateKey, {
        ...state,
        todos: {
          ...state.todos,
          [event.payload.todoId]: {
            completed: event.payload.completed,
            removed: todo?.removed ?? false,
          },
        },
      })
    },
    [todoRemovedEvent.type]: (event, store) => {
      const state = todoCheerCommandState(store)
      const todo = state.todos[event.payload.todoId]

      store.set(stateKey, {
        ...state,
        todos: {
          ...state.todos,
          [event.payload.todoId]: {
            completed: todo?.completed ?? false,
            removed: true,
          },
        },
      })
    },
    [todoCheerCreatedEvent.type]: (event, store) => {
      const state = todoCheerCommandState(store)
      store.set(stateKey, {
        ...state,
        milestones: [...state.milestones, event.payload.milestone],
      })
    },
  })
  .decide((command, store) => {
    if (command.milestone % 5 !== 0) {
      return [
        errorEvent.create({
          message: 'Todo cheer milestone must be a multiple of 5',
        }),
      ]
    }

    const state = todoCheerCommandState(store)
    const completedCount = Object.values(state.todos).filter(
      (todo) => todo.completed && !todo.removed,
    ).length

    if (completedCount < command.milestone) {
      return [
        errorEvent.create({
          message: 'Todo cheer milestone has not been reached',
        }),
      ]
    }

    if (state.milestones.includes(command.milestone)) {
      return [
        errorEvent.create({
          message: 'Todo cheer milestone already exists',
        }),
      ]
    }

    return [
      todoCheerCreatedEvent.create({
        milestone: command.milestone,
        message: `Nice work: ${command.milestone} todos completed.`,
      }),
    ]
  })

import { createReactionSpec } from '../../../lib_legacy/registry.builders'
import {
  todoAddedEvent,
  todoCheerCreatedEvent,
  todoCompletionChangedEvent,
  todoRemovedEvent,
  type Event,
} from '../events'

type TodoCompletionCheerState = {
  todos: Record<string, { completed: boolean; removed: boolean }>
  milestones: number[]
}

const stateKey = 'state'

function todoCompletionCheerState(store: {
  get: <TValue>(key: string) => TValue | undefined
}) {
  return (
    store.get<TodoCompletionCheerState>(stateKey) ?? {
      todos: {},
      milestones: [],
    }
  )
}

function completedTodoEvents(count: number): Event[] {
  return Array.from({ length: count }, (_, index) => {
    const todoId = `todo-${index + 1}`

    return [
      todoAddedEvent.create({ todoId, title: todoId }),
      todoCompletionChangedEvent.create({ todoId, completed: true }),
    ]
  }).flat()
}

export const todoCompletionCheer = createReactionSpec('todoCompletionCheer', {
  json: true,
})
  .scenarios(
    {
      given: completedTodoEvents(4),
      when: todoCompletionChangedEvent.create({
        todoId: 'todo-4',
        completed: true,
      }),
      expect: [],
    },
    {
      given: completedTodoEvents(5),
      when: todoCompletionChangedEvent.create({
        todoId: 'todo-5',
        completed: true,
      }),
      expect: [{ type: 'createTodoCheer', payload: { milestone: 5 } }],
    },
    {
      given: [
        ...completedTodoEvents(5),
        todoCheerCreatedEvent.create({
          milestone: 5,
          message: 'Nice work: 5 todos completed.',
        }),
        todoCompletionChangedEvent.create({
          todoId: 'todo-5',
          completed: false,
        }),
        todoCompletionChangedEvent.create({
          todoId: 'todo-5',
          completed: true,
        }),
      ],
      when: todoCompletionChangedEvent.create({
        todoId: 'todo-5',
        completed: true,
      }),
      expect: [],
    },
    {
      given: [
        ...completedTodoEvents(5),
        todoCheerCreatedEvent.create({
          milestone: 5,
          message: 'Nice work: 5 todos completed.',
        }),
        todoRemovedEvent.create({ todoId: 'todo-5' }),
      ],
      when: todoCompletionChangedEvent.create({
        todoId: 'todo-4',
        completed: true,
      }),
      expect: [],
    },
  )
  .apply({
    [todoAddedEvent.type]: (event, store) => {
      const state = todoCompletionCheerState(store)
      store.set(stateKey, {
        ...state,
        todos: {
          ...state.todos,
          [event.payload.todoId]: { completed: false, removed: false },
        },
      })
    },
    [todoCompletionChangedEvent.type]: (event, store) => {
      const state = todoCompletionCheerState(store)
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
      const state = todoCompletionCheerState(store)
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
      const state = todoCompletionCheerState(store)
      store.set(stateKey, {
        ...state,
        milestones: [...state.milestones, event.payload.milestone],
      })
    },
  })
  .react((store) => {
    const state = todoCompletionCheerState(store)
    const completedCount = Object.values(state.todos).filter(
      (todo) => todo.completed && !todo.removed,
    ).length

    if (completedCount === 0 || completedCount % 5 !== 0) {
      return []
    }

    if (state.milestones.includes(completedCount)) {
      return []
    }

    return [
      {
        type: 'createTodoCheer',
        payload: { milestone: completedCount },
      },
    ]
  })

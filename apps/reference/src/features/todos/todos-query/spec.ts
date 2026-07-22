import { createQuerySlice, event } from '@specter-ts/spec'

export const todosQuerySpec = createQuerySlice('todosQuery')
  .description('Lists visible todos by status.')
  .scenarios(
    {
      description: 'Returns an empty list when no todos exist.',
      given: [],
      when: { status: 'all' },
      expect: [],
    },
    {
      description: 'Returns all visible todos.',
      given: [
        event('todo-added', { todoId: 'todo-1', title: 'Ship it' }),
        event('todo-added', { todoId: 'todo-2', title: 'Review it' }),
      ],
      when: { status: 'all' },
      expect: [
        { id: 'todo-1', title: 'Ship it', completed: false, removed: false },
        { id: 'todo-2', title: 'Review it', completed: false, removed: false },
      ],
    },
    {
      description: 'Returns only active visible todos.',
      given: [
        event('todo-added', { todoId: 'todo-1', title: 'Ship it' }),
        event('todo-completion-changed', { todoId: 'todo-1', completed: true }),
        event('todo-added', { todoId: 'todo-2', title: 'Review it' }),
      ],
      when: { status: 'active' },
      expect: [
        { id: 'todo-2', title: 'Review it', completed: false, removed: false },
      ],
    },
    {
      description: 'Returns only completed visible todos.',
      given: [
        event('todo-added', { todoId: 'todo-1', title: 'Ship it' }),
        event('todo-completion-changed', { todoId: 'todo-1', completed: true }),
        event('todo-added', { todoId: 'todo-2', title: 'Review it' }),
      ],
      when: { status: 'completed' },
      expect: [
        { id: 'todo-1', title: 'Ship it', completed: true, removed: false },
      ],
    },
    {
      description: 'Excludes removed todos from the list.',
      given: [
        event('todo-added', { todoId: 'todo-1', title: 'Ship it' }),
        event('todo-removed', { todoId: 'todo-1' }),
      ],
      when: { status: 'all' },
      expect: [],
    },
  )

export default todosQuerySpec

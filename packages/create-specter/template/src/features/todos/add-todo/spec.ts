import { createCommandSlice, event } from '@specter-ts/spec'

const maxTitleLength = 120

export const addTodoSpec = createCommandSlice('addTodo')
  .description('Adds a todo to the list.')
  .scenarios(
    {
      description: 'Creates a todo with the provided title.',
      given: [],
      when: { todoId: 'todo-1', title: 'Ship it' },
      expect: [event('todo-added', { todoId: 'todo-1', title: 'Ship it' })],
    },
    {
      description: 'Trims surrounding whitespace before creating a todo.',
      given: [],
      when: { todoId: 'todo-1', title: '  Ship it  ' },
      expect: [event('todo-added', { todoId: 'todo-1', title: 'Ship it' })],
    },
    {
      description: 'Rejects a blank todo title.',
      given: [],
      when: { todoId: 'todo-1', title: '   ' },
      expect: [],
      reject: { reason: 'Todo title is required' },
    },
    {
      description: 'Rejects a todo title longer than the limit.',
      given: [],
      when: { todoId: 'todo-1', title: 'x'.repeat(maxTitleLength + 1) },
      expect: [],
      reject: {
        reason: `Todo title must be ${maxTitleLength} characters or less`,
      },
    },
  )

export default addTodoSpec

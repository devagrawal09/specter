import { createCommandSlice, event } from '@specter-ts/core/spec'

const removeTodoSpec = createCommandSlice('removeTodo')
  .description('Removes an existing todo.')
  .scenarios(
    {
      description: 'Removes an active todo.',
      given: [event('todo-added', { todoId: 'todo-1', title: 'Ship it' })],
      when: { todoId: 'todo-1' },
      expect: [event('todo-removed', { todoId: 'todo-1' })],
    },
    {
      description: 'Rejects removing a missing todo.',
      given: [],
      when: { todoId: 'missing' },
      expect: [],
    },
    {
      description: 'Rejects removing a todo twice.',
      given: [
        event('todo-added', { todoId: 'todo-1', title: 'Ship it' }),
        event('todo-removed', { todoId: 'todo-1' }),
      ],
      when: { todoId: 'todo-1' },
      expect: [],
    },
  )

export default removeTodoSpec

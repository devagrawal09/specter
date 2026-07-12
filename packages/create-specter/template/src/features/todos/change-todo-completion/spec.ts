import { createCommandSlice, event } from '@specter-ts/core/spec'

const changeTodoCompletionSpec = createCommandSlice('changeTodoCompletion')
  .description('Changes whether an existing todo is completed.')
  .scenarios(
    {
      description: 'Marks an active todo as completed.',
      given: [event('todo-added', { todoId: 'todo-1', title: 'Ship it' })],
      when: { todoId: 'todo-1', completed: true },
      expect: [
        event('todo-completion-changed', {
          todoId: 'todo-1',
          completed: true,
        }),
      ],
    },
    {
      description: 'Rejects a completion change that matches current state.',
      given: [
        event('todo-added', { todoId: 'todo-1', title: 'Ship it' }),
        event('todo-completion-changed', {
          todoId: 'todo-1',
          completed: true,
        }),
      ],
      when: { todoId: 'todo-1', completed: true },
      expect: [],
    },
    {
      description: 'Rejects a completion change for a missing todo.',
      given: [],
      when: { todoId: 'missing', completed: true },
      expect: [],
    },
    {
      description: 'Rejects a completion change for a removed todo.',
      given: [
        event('todo-added', { todoId: 'todo-1', title: 'Ship it' }),
        event('todo-removed', { todoId: 'todo-1' }),
      ],
      when: { todoId: 'todo-1', completed: true },
      expect: [],
    },
  )

export default changeTodoCompletionSpec

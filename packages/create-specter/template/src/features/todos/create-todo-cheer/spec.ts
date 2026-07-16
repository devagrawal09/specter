import { createCommandSlice, event } from '@specter-ts/core/spec'

function completedTodoEvents(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const todoId = `todo-${index + 1}`
    return [
      event('todo-added', { todoId, title: todoId }),
      event('todo-completion-changed', { todoId, completed: true }),
    ]
  }).flat()
}

export const createTodoCheerSpec = createCommandSlice('createTodoCheer')
  .description('Creates milestone cheers for completed todos.')
  .scenarios(
    {
      description: 'Rejects a cheer milestone that is not a multiple of five.',
      given: [],
      when: { milestone: 4 },
      expect: [],
    },
    {
      description:
        'Rejects a cheer milestone before enough todos are completed.',
      given: completedTodoEvents(4),
      when: { milestone: 5 },
      expect: [],
    },
    {
      description: 'Rejects a cheer milestone that was already created.',
      given: [
        ...completedTodoEvents(5),
        event('todo-cheer-created', {
          milestone: 5,
          message: 'Nice work: 5 todos completed.',
        }),
      ],
      when: { milestone: 5 },
      expect: [],
    },
    {
      description:
        'Creates a cheer when the completed todo count reaches a milestone.',
      given: completedTodoEvents(5),
      when: { milestone: 5 },
      expect: [
        event('todo-cheer-created', {
          milestone: 5,
          message: 'Nice work: 5 todos completed.',
        }),
      ],
    },
    {
      description:
        'Rejects a cheer milestone when a completed todo was removed.',
      given: [
        ...completedTodoEvents(5),
        event('todo-removed', { todoId: 'todo-5' }),
      ],
      when: { milestone: 5 },
      expect: [],
    },
  )

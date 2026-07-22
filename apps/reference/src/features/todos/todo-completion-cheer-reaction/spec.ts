import { createReactionSlice, event } from '@specter-ts/spec'

function completedTodoEvents(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const todoId = `todo-${index + 1}`
    return [
      event('todo-added', { todoId, title: todoId }),
      event('todo-completion-changed', { todoId, completed: true }),
    ]
  }).flat()
}

export const todoCompletionCheerSpec = createReactionSlice(
  'todoCompletionCheer',
)
  .description(
    'Requests cheer creation when completion milestones are reached.',
  )
  .scenarios(
    {
      description: 'Does not request a cheer before a milestone is reached.',
      given: [
        ...completedTodoEvents(4),
        event('todo-completion-changed', { todoId: 'todo-4', completed: true }),
      ],
      expect: [],
    },
    {
      description: 'Requests a cheer when five todos are completed.',
      given: [
        ...completedTodoEvents(5),
        event('todo-completion-changed', { todoId: 'todo-5', completed: true }),
      ],
      expect: [{ type: 'createTodoCheer', payload: { milestone: 5 } }],
    },
    {
      description: 'Does not request a cheer for an already-created milestone.',
      given: [
        ...completedTodoEvents(5),
        event('todo-cheer-created', {
          milestone: 5,
          message: 'Nice work: 5 todos completed.',
        }),
        event('todo-completion-changed', {
          todoId: 'todo-5',
          completed: false,
        }),
        event('todo-completion-changed', { todoId: 'todo-5', completed: true }),
      ],
      expect: [],
    },
    {
      description:
        'Does not request a cheer when a completed todo was removed.',
      given: [
        ...completedTodoEvents(5),
        event('todo-cheer-created', {
          milestone: 5,
          message: 'Nice work: 5 todos completed.',
        }),
        event('todo-removed', { todoId: 'todo-5' }),
      ],
      expect: [],
    },
  )

export default todoCompletionCheerSpec

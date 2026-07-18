import { createCommandSlice, event } from '@specter-ts/core/spec'

const at = '2026-07-18T15:00:00.000Z'

export const changeTaskArchivedSpec = createCommandSlice('changeTaskArchived')
  .description('Archives or restores a task without deleting its history.')
  .scenarios(
    {
      description: 'Archives an active task.',
      given: [
        event('task-added', {
          taskId: 'task-1',
          title: 'Task',
          notes: null,
          dueAt: null,
          createdAt: at,
        }),
      ],
      when: { taskId: 'task-1', archived: true, changedAt: at },
      expect: [
        event('task-archive-changed', {
          taskId: 'task-1',
          archived: true,
          changedAt: at,
        }),
      ],
    },
    {
      description: 'Restores an edited archived task.',
      given: [
        event('task-added', {
          taskId: 'task-1',
          title: 'Task',
          notes: null,
          dueAt: null,
          createdAt: at,
        }),
        event('task-edited', {
          taskId: 'task-1',
          title: 'Edited',
          notes: null,
          dueAt: null,
          editedAt: at,
        }),
        event('task-archive-changed', {
          taskId: 'task-1',
          archived: true,
          changedAt: at,
        }),
      ],
      when: { taskId: 'task-1', archived: false, changedAt: at },
      expect: [
        event('task-archive-changed', {
          taskId: 'task-1',
          archived: false,
          changedAt: at,
        }),
      ],
    },
  )

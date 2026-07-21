import { createCommandSlice, event } from '@specter-ts/core/spec'

const at = '2026-07-18T15:00:00.000Z'

export const editTaskSpec = createCommandSlice('editTask')
  .description('Edits the descriptive and due-date fields of a task.')
  .scenarios(
    {
      description: 'Edits an active task.',
      given: [
        event('task-added', {
          taskId: 'task-1',
          title: 'Draft',
          notes: null,
          dueAt: null,
          createdAt: at,
        }),
      ],
      when: {
        taskId: 'task-1',
        title: 'Final',
        notes: 'Details',
        dueAt: at,
        editedAt: at,
      },
      expect: [
        event('task-edited', {
          taskId: 'task-1',
          title: 'Final',
          notes: 'Details',
          dueAt: at,
          editedAt: at,
        }),
      ],
    },
    {
      description: 'Edits a previously edited task.',
      given: [
        event('task-added', {
          taskId: 'task-1',
          title: 'Draft',
          notes: null,
          dueAt: null,
          createdAt: at,
        }),
        event('task-edited', {
          taskId: 'task-1',
          title: 'Middle',
          notes: null,
          dueAt: null,
          editedAt: at,
        }),
      ],
      when: {
        taskId: 'task-1',
        title: 'Final',
        notes: null,
        dueAt: null,
        editedAt: at,
      },
      expect: [
        event('task-edited', {
          taskId: 'task-1',
          title: 'Final',
          notes: null,
          dueAt: null,
          editedAt: at,
        }),
      ],
    },
    {
      description: 'Rejects editing an archived task.',
      given: [
        event('task-added', {
          taskId: 'task-1',
          title: 'Draft',
          notes: null,
          dueAt: null,
          createdAt: at,
        }),
        event('task-archive-changed', {
          taskId: 'task-1',
          archived: true,
          changedAt: at,
        }),
      ],
      when: {
        taskId: 'task-1',
        title: 'Final',
        notes: null,
        dueAt: null,
        editedAt: at,
      },
      expect: [],
      reject: { reason: 'Task not found' },
    },
  )

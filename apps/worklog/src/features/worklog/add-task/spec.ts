import { createCommandSlice, event } from '@specter-ts/spec'

const at = '2026-07-18T15:00:00.000Z'

export const addTaskSpec = createCommandSlice('addTask')
  .description('Adds a one-off task.')
  .scenarios(
    {
      description: 'Adds a task and awards its creation point.',
      given: [],
      when: {
        taskId: 'task-1',
        title: 'Ship Worklog',
        notes: null,
        dueAt: null,
        createdAt: at,
      },
      expect: [
        event('task-added', {
          taskId: 'task-1',
          title: 'Ship Worklog',
          notes: null,
          dueAt: null,
          createdAt: at,
        }),
        event('point-awarded', {
          awardKey: 'task:task-1:created',
          reason: 'task-added',
          points: 1,
          subject: { kind: 'task', id: 'task-1' },
          related: [],
          awardedAt: at,
        }),
      ],
    },
    {
      description: 'Rejects a reused task identifier.',
      given: [
        event('task-added', {
          taskId: 'task-1',
          title: 'Existing',
          notes: null,
          dueAt: null,
          createdAt: at,
        }),
      ],
      when: {
        taskId: 'task-1',
        title: 'Duplicate',
        notes: null,
        dueAt: null,
        createdAt: at,
      },
      expect: [],
      reject: { reason: 'Task already exists' },
    },
  )

export default addTaskSpec

import { createQuerySlice, event } from '@specter-ts/core/spec'

const at = '2026-07-18T15:00:00.000Z'

export const tasksQuerySpec = createQuerySlice('tasksQuery')
  .description('Lists current tasks with status and optional topic filtering.')
  .scenarios({
    description: 'Returns active tasks connected to the requested topic.',
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
        title: 'Final',
        notes: 'Details',
        dueAt: at,
        editedAt: at,
      }),
      event('task-completion-changed', {
        taskId: 'task-1',
        completed: true,
        changedAt: at,
      }),
      event('task-added', {
        taskId: 'task-2',
        title: 'Archived',
        notes: null,
        dueAt: null,
        createdAt: at,
      }),
      event('task-archive-changed', {
        taskId: 'task-2',
        archived: true,
        changedAt: at,
      }),
      event('records-connected', {
        connectionId: 'connection-1',
        left: { kind: 'task', id: 'task-1' },
        right: { kind: 'topic', id: 'topic-1' },
        connectedAt: at,
      }),
      event('connection-archive-changed', {
        connectionId: 'connection-1',
        archived: false,
        changedAt: at,
      }),
    ],
    when: { status: 'completed', topicId: 'topic-1' },
    expect: [
      {
        id: 'task-1',
        title: 'Final',
        notes: 'Details',
        dueAt: at,
        createdAt: at,
        completed: true,
        completedAt: at,
        archived: false,
      },
    ],
  })

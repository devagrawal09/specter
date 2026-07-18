import { createQuerySlice, event } from '@specter-ts/core/spec'

const at = '2026-07-18T15:00:00.000Z'

export const topicsQuerySpec = createQuerySlice('topicsQuery')
  .description('Lists topics with connected-task completion progress.')
  .scenarios({
    description: 'Projects topic edits, archival, and active task progress.',
    given: [
      event('topic-added', {
        topicId: 'topic-1',
        name: 'Draft',
        description: null,
        createdAt: at,
      }),
      event('topic-edited', {
        topicId: 'topic-1',
        name: 'Final',
        description: 'Details',
        editedAt: at,
      }),
      event('topic-archive-changed', {
        topicId: 'topic-1',
        archived: false,
        changedAt: at,
      }),
      event('task-added', {
        taskId: 'task-1',
        title: 'Task',
        notes: null,
        dueAt: null,
        createdAt: at,
      }),
      event('task-completion-changed', {
        taskId: 'task-1',
        completed: true,
        changedAt: at,
      }),
      event('task-archive-changed', {
        taskId: 'task-1',
        archived: false,
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
    when: { includeArchived: false },
    expect: [
      {
        id: 'topic-1',
        name: 'Final',
        description: 'Details',
        createdAt: at,
        archived: false,
        taskCount: 1,
        completedTaskCount: 1,
      },
    ],
  })

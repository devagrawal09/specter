import { createCommandSlice, event } from '@specter-ts/spec'

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
    {
      description:
        'Restores a completed task and awards newly eligible connection and topic points.',
      given: [
        event('journal-entry-added', {
          journalEntryId: 'journal-coverage',
          body: 'Journal',
          activityAt: at,
          createdAt: at,
        }),
        event('journal-entry-archive-changed', {
          journalEntryId: 'journal-coverage',
          archived: true,
          changedAt: at,
        }),
        event('journal-entry-archive-changed', {
          journalEntryId: 'journal-coverage',
          archived: false,
          changedAt: at,
        }),
        event('topic-added', {
          topicId: 'topic-1',
          name: 'Topic',
          description: null,
          createdAt: at,
        }),
        event('topic-archive-changed', {
          topicId: 'topic-1',
          archived: true,
          changedAt: at,
        }),
        event('topic-archive-changed', {
          topicId: 'topic-1',
          archived: false,
          changedAt: at,
        }),
        ...['task-1', 'task-2', 'task-3'].flatMap((taskId) => [
          event('task-added', {
            taskId,
            title: taskId,
            notes: null,
            dueAt: null,
            createdAt: at,
          }),
          event('task-completion-changed', {
            taskId,
            completed: true,
            changedAt: at,
          }),
        ]),
        event('point-awarded', {
          awardKey: 'task:task-1:first-completion',
          reason: 'task-first-completed',
          points: 1,
          subject: { kind: 'task', id: 'task-1' },
          related: [],
          awardedAt: at,
        }),
        ...['task-1', 'task-2', 'task-3'].map((taskId, index) =>
          event('records-connected', {
            connectionId: `connection-${index + 1}`,
            left: { kind: 'task', id: taskId },
            right: { kind: 'topic', id: 'topic-1' },
            connectedAt: at,
          }),
        ),
        event('connection-archive-changed', {
          connectionId: 'connection-2',
          archived: true,
          changedAt: at,
        }),
        event('connection-archive-changed', {
          connectionId: 'connection-2',
          archived: false,
          changedAt: at,
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
        event('point-awarded', {
          awardKey: 'connection:connection-1:completed-task',
          reason: 'completed-task-connection',
          points: 1,
          subject: { kind: 'task', id: 'task-1' },
          related: [{ kind: 'topic', id: 'topic-1' }],
          awardedAt: at,
        }),
        event('point-awarded', {
          awardKey: 'topic:topic-1:all-tasks-completed',
          reason: 'topic-all-tasks-completed',
          points: 1,
          subject: { kind: 'topic', id: 'topic-1' },
          related: [
            { kind: 'task', id: 'task-1' },
            { kind: 'task', id: 'task-2' },
            { kind: 'task', id: 'task-3' },
          ],
          awardedAt: at,
        }),
      ],
    },
    {
      description:
        'Restores a completed task without repeating a connection award.',
      given: [
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
        event('topic-added', {
          topicId: 'topic-1',
          name: 'Topic',
          description: null,
          createdAt: at,
        }),
        event('records-connected', {
          connectionId: 'connection-1',
          left: { kind: 'task', id: 'task-1' },
          right: { kind: 'topic', id: 'topic-1' },
          connectedAt: at,
        }),
        event('point-awarded', {
          awardKey: 'connection:connection-1:completed-task',
          reason: 'completed-task-connection',
          points: 1,
          subject: { kind: 'task', id: 'task-1' },
          related: [{ kind: 'topic', id: 'topic-1' }],
          awardedAt: at,
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
    {
      description:
        'Archives an incomplete fourth topic task and awards the newly eligible milestone.',
      given: [
        event('topic-added', {
          topicId: 'topic-archive-milestone',
          name: 'Archive milestone',
          description: null,
          createdAt: at,
        }),
        ...['task-1', 'task-2', 'task-3', 'task-4'].flatMap((taskId, index) => [
          event('task-added', {
            taskId,
            title: taskId,
            notes: null,
            dueAt: null,
            createdAt: at,
          }),
          ...(index < 3
            ? [
                event('task-completion-changed', {
                  taskId,
                  completed: true,
                  changedAt: at,
                }),
              ]
            : []),
          event('records-connected', {
            connectionId: `connection-${index + 1}`,
            left: { kind: 'task', id: taskId },
            right: { kind: 'topic', id: 'topic-archive-milestone' },
            connectedAt: at,
          }),
        ]),
      ],
      when: { taskId: 'task-4', archived: true, changedAt: at },
      expect: [
        event('task-archive-changed', {
          taskId: 'task-4',
          archived: true,
          changedAt: at,
        }),
        event('point-awarded', {
          awardKey: 'topic:topic-archive-milestone:all-tasks-completed',
          reason: 'topic-all-tasks-completed',
          points: 1,
          subject: { kind: 'topic', id: 'topic-archive-milestone' },
          related: [
            { kind: 'task', id: 'task-1' },
            { kind: 'task', id: 'task-2' },
            { kind: 'task', id: 'task-3' },
          ],
          awardedAt: at,
        }),
      ],
    },
  )

export default changeTaskArchivedSpec

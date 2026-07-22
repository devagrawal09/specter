import { createCommandSlice, event } from '@specter-ts/spec'

const at = '2026-07-18T15:00:00.000Z'
const connected = event('records-connected', {
  connectionId: 'connection-1',
  left: { kind: 'task', id: 'task-1' },
  right: { kind: 'topic', id: 'topic-1' },
  connectedAt: at,
})
const task = (id: string) =>
  event('task-added', {
    taskId: id,
    title: id,
    notes: null,
    dueAt: null,
    createdAt: at,
  })
const completed = (id: string) =>
  event('task-completion-changed', {
    taskId: id,
    completed: true,
    changedAt: at,
  })

export const changeConnectionArchivedSpec = createCommandSlice(
  'changeConnectionArchived',
)
  .description('Archives or restores an existing connection.')
  .scenarios(
    {
      description: 'Archives an active connection.',
      given: [connected],
      when: { connectionId: 'connection-1', archived: true, changedAt: at },
      expect: [
        event('connection-archive-changed', {
          connectionId: 'connection-1',
          archived: true,
          changedAt: at,
        }),
      ],
    },
    {
      description:
        'Restores an archived connection without awarding points again.',
      given: [
        task('task-1'),
        completed('task-1'),
        event('topic-added', {
          topicId: 'topic-1',
          name: 'Topic',
          description: null,
          createdAt: at,
        }),
        connected,
        event('point-awarded', {
          awardKey: 'connection:connection-1:completed-task',
          reason: 'completed-task-connection',
          points: 1,
          subject: { kind: 'task', id: 'task-1' },
          related: [{ kind: 'topic', id: 'topic-1' }],
          awardedAt: at,
        }),
        event('connection-archive-changed', {
          connectionId: 'connection-1',
          archived: true,
          changedAt: at,
        }),
      ],
      when: { connectionId: 'connection-1', archived: false, changedAt: at },
      expect: [
        event('connection-archive-changed', {
          connectionId: 'connection-1',
          archived: false,
          changedAt: at,
        }),
      ],
    },
    {
      description:
        'Restores a completed task connection and awards its missing point.',
      given: [
        event('journal-entry-added', {
          journalEntryId: 'journal-1',
          body: 'Entry',
          activityAt: at,
          createdAt: at,
        }),
        event('journal-entry-archive-changed', {
          journalEntryId: 'journal-1',
          archived: true,
          changedAt: at,
        }),
        event('journal-entry-archive-changed', {
          journalEntryId: 'journal-1',
          archived: false,
          changedAt: at,
        }),
        task('task-1'),
        completed('task-1'),
        event('task-archive-changed', {
          taskId: 'task-1',
          archived: true,
          changedAt: at,
        }),
        event('task-archive-changed', {
          taskId: 'task-1',
          archived: false,
          changedAt: at,
        }),
        event('records-connected', {
          connectionId: 'connection-journal',
          left: { kind: 'task', id: 'task-1' },
          right: { kind: 'journal', id: 'journal-1' },
          connectedAt: at,
        }),
        event('connection-archive-changed', {
          connectionId: 'connection-journal',
          archived: true,
          changedAt: at,
        }),
      ],
      when: {
        connectionId: 'connection-journal',
        archived: false,
        changedAt: at,
      },
      expect: [
        event('connection-archive-changed', {
          connectionId: 'connection-journal',
          archived: false,
          changedAt: at,
        }),
        event('point-awarded', {
          awardKey: 'connection:connection-journal:completed-task',
          reason: 'completed-task-connection',
          points: 1,
          subject: { kind: 'task', id: 'task-1' },
          related: [{ kind: 'journal', id: 'journal-1' }],
          awardedAt: at,
        }),
      ],
    },
    {
      description:
        'Restores the third completed task connection and awards the topic milestone.',
      given: [
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
        task('task-1'),
        completed('task-1'),
        task('task-2'),
        completed('task-2'),
        task('task-3'),
        completed('task-3'),
        ...['1', '2', '3'].map((suffix) =>
          event('records-connected', {
            connectionId: `connection-${suffix}`,
            left: { kind: 'task', id: `task-${suffix}` },
            right: { kind: 'topic', id: 'topic-1' },
            connectedAt: at,
          }),
        ),
        event('point-awarded', {
          awardKey: 'connection:connection-1:completed-task',
          reason: 'completed-task-connection',
          points: 1,
          subject: { kind: 'task', id: 'task-1' },
          related: [{ kind: 'topic', id: 'topic-1' }],
          awardedAt: at,
        }),
        event('point-awarded', {
          awardKey: 'connection:connection-2:completed-task',
          reason: 'completed-task-connection',
          points: 1,
          subject: { kind: 'task', id: 'task-2' },
          related: [{ kind: 'topic', id: 'topic-1' }],
          awardedAt: at,
        }),
        event('connection-archive-changed', {
          connectionId: 'connection-3',
          archived: true,
          changedAt: at,
        }),
      ],
      when: { connectionId: 'connection-3', archived: false, changedAt: at },
      expect: [
        event('connection-archive-changed', {
          connectionId: 'connection-3',
          archived: false,
          changedAt: at,
        }),
        event('point-awarded', {
          awardKey: 'connection:connection-3:completed-task',
          reason: 'completed-task-connection',
          points: 1,
          subject: { kind: 'task', id: 'task-3' },
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
        'Archives an incomplete fourth task connection and awards the newly eligible topic milestone.',
      given: [
        event('topic-added', {
          topicId: 'topic-archive-milestone',
          name: 'Archive milestone',
          description: null,
          createdAt: at,
        }),
        ...['task-1', 'task-2', 'task-3', 'task-4'].flatMap((taskId, index) => [
          task(taskId),
          ...(index < 3 ? [completed(taskId)] : []),
          event('records-connected', {
            connectionId: `archive-connection-${index + 1}`,
            left: { kind: 'task', id: taskId },
            right: { kind: 'topic', id: 'topic-archive-milestone' },
            connectedAt: at,
          }),
        ]),
      ],
      when: {
        connectionId: 'archive-connection-4',
        archived: true,
        changedAt: at,
      },
      expect: [
        event('connection-archive-changed', {
          connectionId: 'archive-connection-4',
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

export default changeConnectionArchivedSpec

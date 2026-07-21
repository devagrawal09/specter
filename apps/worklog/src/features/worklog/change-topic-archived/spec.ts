import { createCommandSlice, event } from '@specter-ts/core/spec'

const at = '2026-07-18T15:00:00.000Z'
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
const connected = (id: string, taskId: string) =>
  event('records-connected', {
    connectionId: id,
    left: { kind: 'task', id: taskId },
    right: { kind: 'topic', id: 'topic-1' },
    connectedAt: at,
  })

export const changeTopicArchivedSpec = createCommandSlice('changeTopicArchived')
  .description('Archives or restores a topic without deleting its history.')
  .scenarios(
    {
      description: 'Archives an active topic.',
      given: [
        event('topic-added', {
          topicId: 'topic-1',
          name: 'Topic',
          description: null,
          createdAt: at,
        }),
      ],
      when: { topicId: 'topic-1', archived: true, changedAt: at },
      expect: [
        event('topic-archive-changed', {
          topicId: 'topic-1',
          archived: true,
          changedAt: at,
        }),
      ],
    },
    {
      description: 'Restores an edited archived topic.',
      given: [
        event('topic-added', {
          topicId: 'topic-1',
          name: 'Topic',
          description: null,
          createdAt: at,
        }),
        event('topic-edited', {
          topicId: 'topic-1',
          name: 'Edited',
          description: null,
          editedAt: at,
        }),
        event('topic-archive-changed', {
          topicId: 'topic-1',
          archived: true,
          changedAt: at,
        }),
      ],
      when: { topicId: 'topic-1', archived: false, changedAt: at },
      expect: [
        event('topic-archive-changed', {
          topicId: 'topic-1',
          archived: false,
          changedAt: at,
        }),
      ],
    },
    {
      description:
        'Restores a topic and awards completed connections and its newly eligible milestone.',
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
        task('task-1'),
        completed('task-1'),
        task('task-2'),
        completed('task-2'),
        task('task-3'),
        completed('task-3'),
        event('task-archive-changed', {
          taskId: 'task-3',
          archived: true,
          changedAt: at,
        }),
        event('task-archive-changed', {
          taskId: 'task-3',
          archived: false,
          changedAt: at,
        }),
        connected('connection-1', 'task-1'),
        connected('connection-2', 'task-2'),
        connected('connection-3', 'task-3'),
        event('connection-archive-changed', {
          connectionId: 'connection-3',
          archived: true,
          changedAt: at,
        }),
        event('connection-archive-changed', {
          connectionId: 'connection-3',
          archived: false,
          changedAt: at,
        }),
      ],
      when: { topicId: 'topic-1', archived: false, changedAt: at },
      expect: [
        event('topic-archive-changed', {
          topicId: 'topic-1',
          archived: false,
          changedAt: at,
        }),
        ...['1', '2', '3'].map((suffix) =>
          event('point-awarded', {
            awardKey: `connection:connection-${suffix}:completed-task`,
            reason: 'completed-task-connection',
            points: 1,
            subject: { kind: 'task', id: `task-${suffix}` },
            related: [{ kind: 'topic', id: 'topic-1' }],
            awardedAt: at,
          }),
        ),
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
      description: 'Restores a topic without repeating prior awards.',
      given: [
        event('topic-added', {
          topicId: 'topic-1',
          name: 'Topic',
          description: null,
          createdAt: at,
        }),
        task('task-1'),
        completed('task-1'),
        task('task-2'),
        completed('task-2'),
        task('task-3'),
        completed('task-3'),
        connected('connection-1', 'task-1'),
        connected('connection-2', 'task-2'),
        connected('connection-3', 'task-3'),
        ...['1', '2', '3'].map((suffix) =>
          event('point-awarded', {
            awardKey: `connection:connection-${suffix}:completed-task`,
            reason: 'completed-task-connection',
            points: 1,
            subject: { kind: 'task', id: `task-${suffix}` },
            related: [{ kind: 'topic', id: 'topic-1' }],
            awardedAt: at,
          }),
        ),
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
        event('topic-archive-changed', {
          topicId: 'topic-1',
          archived: true,
          changedAt: at,
        }),
      ],
      when: { topicId: 'topic-1', archived: false, changedAt: at },
      expect: [
        event('topic-archive-changed', {
          topicId: 'topic-1',
          archived: false,
          changedAt: at,
        }),
      ],
    },
  )

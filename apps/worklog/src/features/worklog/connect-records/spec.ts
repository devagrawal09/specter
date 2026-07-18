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

export const connectRecordsSpec = createCommandSlice('connectRecords')
  .description(
    'Creates a unique symmetric association between supported records.',
  )
  .scenarios(
    {
      description:
        'Connects a journal to a completed task and awards both connection points.',
      given: [
        event('journal-entry-added', {
          journalEntryId: 'journal-1',
          body: 'Entry',
          activityAt: at,
          createdAt: at,
        }),
        task('task-1'),
        event('task-completion-changed', {
          taskId: 'task-1',
          completed: true,
          changedAt: at,
        }),
        event('point-awarded', {
          awardKey: 'task:task-1:first-completion',
          reason: 'task-first-completed',
          points: 1,
          subject: { kind: 'task', id: 'task-1' },
          related: [],
          awardedAt: at,
        }),
      ],
      when: {
        connectionId: 'connection-1',
        left: { kind: 'journal', id: 'journal-1' },
        right: { kind: 'task', id: 'task-1' },
        connectedAt: at,
      },
      expect: [
        event('records-connected', {
          connectionId: 'connection-1',
          left: { kind: 'journal', id: 'journal-1' },
          right: { kind: 'task', id: 'task-1' },
          connectedAt: at,
        }),
        event('point-awarded', {
          awardKey: 'connection:connection-1:created',
          reason: 'connection-added',
          points: 1,
          subject: { kind: 'connection', id: 'connection-1' },
          related: [
            { kind: 'journal', id: 'journal-1' },
            { kind: 'task', id: 'task-1' },
          ],
          awardedAt: at,
        }),
        event('point-awarded', {
          awardKey: 'connection:connection-1:completed-task',
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
        'Connects a third completed task and awards the topic milestone.',
      given: [
        event('topic-added', {
          topicId: 'topic-1',
          name: 'Topic',
          description: null,
          createdAt: at,
        }),
        task('task-1'),
        task('task-2'),
        task('task-3'),
        event('task-completion-changed', {
          taskId: 'task-1',
          completed: true,
          changedAt: at,
        }),
        event('task-completion-changed', {
          taskId: 'task-2',
          completed: true,
          changedAt: at,
        }),
        event('task-completion-changed', {
          taskId: 'task-3',
          completed: true,
          changedAt: at,
        }),
        event('records-connected', {
          connectionId: 'connection-1',
          left: { kind: 'task', id: 'task-1' },
          right: { kind: 'topic', id: 'topic-1' },
          connectedAt: at,
        }),
        event('records-connected', {
          connectionId: 'connection-2',
          left: { kind: 'task', id: 'task-2' },
          right: { kind: 'topic', id: 'topic-1' },
          connectedAt: at,
        }),
      ],
      when: {
        connectionId: 'connection-3',
        left: { kind: 'task', id: 'task-3' },
        right: { kind: 'topic', id: 'topic-1' },
        connectedAt: at,
      },
      expect: [
        event('records-connected', {
          connectionId: 'connection-3',
          left: { kind: 'task', id: 'task-3' },
          right: { kind: 'topic', id: 'topic-1' },
          connectedAt: at,
        }),
        event('point-awarded', {
          awardKey: 'connection:connection-3:created',
          reason: 'connection-added',
          points: 1,
          subject: { kind: 'connection', id: 'connection-3' },
          related: [
            { kind: 'task', id: 'task-3' },
            { kind: 'topic', id: 'topic-1' },
          ],
          awardedAt: at,
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
      description: 'Rejects recreating an archived endpoint pair.',
      given: [
        event('journal-entry-added', {
          journalEntryId: 'journal-1',
          body: 'Entry',
          activityAt: at,
          createdAt: at,
        }),
        event('topic-added', {
          topicId: 'topic-1',
          name: 'Topic',
          description: null,
          createdAt: at,
        }),
        event('records-connected', {
          connectionId: 'connection-1',
          left: { kind: 'journal', id: 'journal-1' },
          right: { kind: 'topic', id: 'topic-1' },
          connectedAt: at,
        }),
        event('connection-archive-changed', {
          connectionId: 'connection-1',
          archived: true,
          changedAt: at,
        }),
      ],
      when: {
        connectionId: 'connection-2',
        left: { kind: 'topic', id: 'topic-1' },
        right: { kind: 'journal', id: 'journal-1' },
        connectedAt: at,
      },
      expect: [],
      reject: { reason: 'Records are already connected' },
    },
    {
      description: 'Rejects an archived endpoint.',
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
        task('task-archived'),
        event('task-archive-changed', {
          taskId: 'task-archived',
          archived: true,
          changedAt: at,
        }),
        event('topic-added', {
          topicId: 'topic-archived',
          name: 'Archived',
          description: null,
          createdAt: at,
        }),
        event('topic-archive-changed', {
          topicId: 'topic-archived',
          archived: true,
          changedAt: at,
        }),
      ],
      when: {
        connectionId: 'connection-1',
        left: { kind: 'journal', id: 'journal-1' },
        right: { kind: 'topic', id: 'topic-archived' },
        connectedAt: at,
      },
      expect: [],
      reject: { reason: 'Connection endpoint not found' },
    },
  )

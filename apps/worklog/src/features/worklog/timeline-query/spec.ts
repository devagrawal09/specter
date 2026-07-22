import { createQuerySlice, event } from '@specter-ts/spec'

const at = '2026-07-18T15:00:00.000Z'

export const timelineQuerySpec = createQuerySlice('timelineQuery')
  .description('Returns the activity-time-ordered Worklog timeline.')
  .scenarios({
    description:
      'Projects current labels and archival state onto timeline activity.',
    given: [
      event('journal-entry-added', {
        journalEntryId: 'journal-1',
        body: 'Draft',
        activityAt: at,
        createdAt: at,
      }),
      event('journal-entry-edited', {
        journalEntryId: 'journal-1',
        body: 'Final entry',
        activityAt: at,
        editedAt: at,
      }),
      event('journal-entry-archive-changed', {
        journalEntryId: 'journal-1',
        archived: true,
        changedAt: at,
      }),
      event('task-added', {
        taskId: 'task-1',
        title: 'Draft task',
        notes: null,
        dueAt: null,
        createdAt: at,
      }),
      event('task-edited', {
        taskId: 'task-1',
        title: 'Final task',
        notes: null,
        dueAt: null,
        editedAt: at,
      }),
      event('task-completion-changed', {
        taskId: 'task-1',
        completed: true,
        changedAt: at,
      }),
      event('task-archive-changed', {
        taskId: 'task-1',
        archived: true,
        changedAt: at,
      }),
      event('topic-added', {
        topicId: 'topic-1',
        name: 'Draft topic',
        description: null,
        createdAt: at,
      }),
      event('topic-edited', {
        topicId: 'topic-1',
        name: 'Final topic',
        description: null,
        editedAt: at,
      }),
      event('topic-archive-changed', {
        topicId: 'topic-1',
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
        archived: true,
        changedAt: at,
      }),
    ],
    when: { includeArchived: true, limit: 50 },
    expect: [
      {
        id: 'scenario-event-11',
        eventType: 'records-connected',
        activityAt: at,
        title: 'Records connected',
        detail: 'Final task ↔ Final topic',
        archived: true,
        subject: null,
      },
      {
        id: 'scenario-event-8',
        eventType: 'topic-added',
        activityAt: at,
        title: 'Final topic',
        detail: 'Topic created',
        archived: true,
        subject: { kind: 'topic', id: 'topic-1' },
      },
      {
        id: 'scenario-event-6',
        eventType: 'task-completion-changed',
        activityAt: at,
        title: 'Final task',
        detail: 'Task completed',
        archived: true,
        subject: { kind: 'task', id: 'task-1' },
      },
      {
        id: 'scenario-event-4',
        eventType: 'task-added',
        activityAt: at,
        title: 'Final task',
        detail: 'Task created',
        archived: true,
        subject: { kind: 'task', id: 'task-1' },
      },
      {
        id: 'scenario-event-1',
        eventType: 'journal-entry-added',
        activityAt: at,
        title: 'Journal',
        detail: 'Final entry',
        archived: true,
        subject: { kind: 'journal', id: 'journal-1' },
      },
    ],
  })

export default timelineQuerySpec

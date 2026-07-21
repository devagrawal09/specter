import { createCommandSlice, event } from '@specter-ts/core/spec'

const at = '2026-07-18T15:00:00.000Z'

export const changeJournalEntryArchivedSpec = createCommandSlice(
  'changeJournalEntryArchived',
)
  .description(
    'Archives or restores a journal entry without deleting its history.',
  )
  .scenarios(
    {
      description: 'Archives an active journal entry.',
      given: [
        event('journal-entry-added', {
          journalEntryId: 'journal-1',
          body: 'Entry',
          activityAt: at,
          createdAt: at,
        }),
      ],
      when: { journalEntryId: 'journal-1', archived: true, changedAt: at },
      expect: [
        event('journal-entry-archive-changed', {
          journalEntryId: 'journal-1',
          archived: true,
          changedAt: at,
        }),
      ],
    },
    {
      description: 'Restores an edited archived journal entry.',
      given: [
        event('journal-entry-added', {
          journalEntryId: 'journal-1',
          body: 'Entry',
          activityAt: at,
          createdAt: at,
        }),
        event('journal-entry-edited', {
          journalEntryId: 'journal-1',
          body: 'Edited',
          activityAt: at,
          editedAt: at,
        }),
        event('journal-entry-archive-changed', {
          journalEntryId: 'journal-1',
          archived: true,
          changedAt: at,
        }),
      ],
      when: { journalEntryId: 'journal-1', archived: false, changedAt: at },
      expect: [
        event('journal-entry-archive-changed', {
          journalEntryId: 'journal-1',
          archived: false,
          changedAt: at,
        }),
      ],
    },
    {
      description:
        'Restores a journal and awards its newly eligible completed-task connection.',
      given: [
        event('journal-entry-added', {
          journalEntryId: 'journal-1',
          body: 'Entry',
          activityAt: at,
          createdAt: at,
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
          archived: true,
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
          right: { kind: 'journal', id: 'journal-1' },
          connectedAt: at,
        }),
        event('connection-archive-changed', {
          connectionId: 'connection-1',
          archived: true,
          changedAt: at,
        }),
        event('connection-archive-changed', {
          connectionId: 'connection-1',
          archived: false,
          changedAt: at,
        }),
        event('journal-entry-archive-changed', {
          journalEntryId: 'journal-1',
          archived: true,
          changedAt: at,
        }),
      ],
      when: { journalEntryId: 'journal-1', archived: false, changedAt: at },
      expect: [
        event('journal-entry-archive-changed', {
          journalEntryId: 'journal-1',
          archived: false,
          changedAt: at,
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
        'Restores a journal without repeating a prior connection award.',
      given: [
        event('journal-entry-added', {
          journalEntryId: 'journal-1',
          body: 'Entry',
          activityAt: at,
          createdAt: at,
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
        event('records-connected', {
          connectionId: 'connection-1',
          left: { kind: 'task', id: 'task-1' },
          right: { kind: 'journal', id: 'journal-1' },
          connectedAt: at,
        }),
        event('point-awarded', {
          awardKey: 'connection:connection-1:completed-task',
          reason: 'completed-task-connection',
          points: 1,
          subject: { kind: 'task', id: 'task-1' },
          related: [{ kind: 'journal', id: 'journal-1' }],
          awardedAt: at,
        }),
        event('journal-entry-archive-changed', {
          journalEntryId: 'journal-1',
          archived: true,
          changedAt: at,
        }),
      ],
      when: { journalEntryId: 'journal-1', archived: false, changedAt: at },
      expect: [
        event('journal-entry-archive-changed', {
          journalEntryId: 'journal-1',
          archived: false,
          changedAt: at,
        }),
      ],
    },
  )

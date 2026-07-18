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
  )

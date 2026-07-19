import { createCommandSlice, event } from '@specter-ts/core/spec'

const at = '2026-07-18T15:00:00.000Z'
const later = '2026-07-18T16:00:00.000Z'

export const editJournalEntrySpec = createCommandSlice('editJournalEntry')
  .description('Corrects the body or activity time of a journal entry.')
  .scenarios(
    {
      description: 'Edits an active journal entry.',
      given: [
        event('journal-entry-added', {
          journalEntryId: 'journal-1',
          body: 'Draft',
          activityAt: at,
          createdAt: at,
        }),
      ],
      when: {
        journalEntryId: 'journal-1',
        body: 'Corrected',
        activityAt: later,
        editedAt: later,
      },
      expect: [
        event('journal-entry-edited', {
          journalEntryId: 'journal-1',
          body: 'Corrected',
          activityAt: later,
          editedAt: later,
        }),
      ],
    },
    {
      description: 'Edits a journal entry that was corrected before.',
      given: [
        event('journal-entry-added', {
          journalEntryId: 'journal-1',
          body: 'Draft',
          activityAt: at,
          createdAt: at,
        }),
        event('journal-entry-edited', {
          journalEntryId: 'journal-1',
          body: 'First correction',
          activityAt: at,
          editedAt: later,
        }),
      ],
      when: {
        journalEntryId: 'journal-1',
        body: 'Final correction',
        activityAt: later,
        editedAt: later,
      },
      expect: [
        event('journal-entry-edited', {
          journalEntryId: 'journal-1',
          body: 'Final correction',
          activityAt: later,
          editedAt: later,
        }),
      ],
    },
    {
      description: 'Rejects editing an archived journal entry.',
      given: [
        event('journal-entry-added', {
          journalEntryId: 'journal-1',
          body: 'Draft',
          activityAt: at,
          createdAt: at,
        }),
        event('journal-entry-archive-changed', {
          journalEntryId: 'journal-1',
          archived: true,
          changedAt: later,
        }),
      ],
      when: {
        journalEntryId: 'journal-1',
        body: 'Nope',
        activityAt: later,
        editedAt: later,
      },
      expect: [],
      reject: { reason: 'Journal entry not found' },
    },
  )

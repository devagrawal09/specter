import { createCommandSlice, event } from '@specter-ts/spec'

const at = '2026-07-18T15:00:00.000Z'

export const addJournalEntrySpec = createCommandSlice('addJournalEntry')
  .description('Adds a journal entry to the activity timeline.')
  .scenarios(
    {
      description:
        'Adds a backdatable journal entry and awards its creation point.',
      given: [],
      when: {
        journalEntryId: 'journal-1',
        body: 'Writing the plan',
        activityAt: at,
        createdAt: at,
      },
      expect: [
        event('journal-entry-added', {
          journalEntryId: 'journal-1',
          body: 'Writing the plan',
          activityAt: at,
          createdAt: at,
        }),
        event('point-awarded', {
          awardKey: 'journal:journal-1:created',
          reason: 'journal-added',
          points: 1,
          subject: { kind: 'journal', id: 'journal-1' },
          related: [],
          awardedAt: at,
        }),
      ],
    },
    {
      description: 'Rejects a reused journal entry identifier.',
      given: [
        event('journal-entry-added', {
          journalEntryId: 'journal-1',
          body: 'Existing',
          activityAt: at,
          createdAt: at,
        }),
      ],
      when: {
        journalEntryId: 'journal-1',
        body: 'Duplicate',
        activityAt: at,
        createdAt: at,
      },
      expect: [],
      reject: { reason: 'Journal entry already exists' },
    },
  )

export default addJournalEntrySpec

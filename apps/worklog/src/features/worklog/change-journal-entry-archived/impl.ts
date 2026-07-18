import { z } from 'zod'

import {
  journalEntryAddedEvent,
  journalEntryArchiveChangedEvent,
  journalEntryEditedEvent,
} from '../events'
import { createWorklogMemoryStore } from '../memory-store'
import type { JournalEntry } from '../model'
import { changeJournalEntryArchivedSpec } from './spec'

const store = createWorklogMemoryStore(() => ({
  journals: new Map<string, JournalEntry>(),
}))

export const changeJournalEntryArchived = changeJournalEntryArchivedSpec
  .inputSchema(
    z
      .object({
        journalEntryId: z.string().min(1),
        archived: z.boolean(),
        changedAt: z.string().datetime({ offset: true }),
      })
      .strict(),
  )
  .store(store)
  .apply(journalEntryAddedEvent, async (event, state) => {
    state.journals.set(event.payload.journalEntryId, {
      id: event.payload.journalEntryId,
      body: event.payload.body,
      activityAt: event.payload.activityAt,
      createdAt: event.payload.createdAt,
      archived: false,
    })
  })
  .apply(journalEntryEditedEvent, async (event, state) => {
    const journal = state.journals.get(event.payload.journalEntryId)
    if (journal)
      Object.assign(journal, {
        body: event.payload.body,
        activityAt: event.payload.activityAt,
      })
  })
  .apply(journalEntryArchiveChangedEvent, async (event, state) => {
    const journal = state.journals.get(event.payload.journalEntryId)
    if (journal) journal.archived = event.payload.archived
  })
  .handle(async (command, state) => {
    const journal = state.journals.get(command.journalEntryId)
    if (!journal) throw new Error('Journal entry not found')
    if (journal.archived === command.archived)
      throw new Error('Journal entry archival state is already requested')
    return [journalEntryArchiveChangedEvent.create(command)]
  })

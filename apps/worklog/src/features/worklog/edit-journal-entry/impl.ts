import { z } from 'zod'

import {
  journalEntryAddedEvent,
  journalEntryArchiveChangedEvent,
  journalEntryEditedEvent,
} from '../events'
import { createWorklogMemoryStore } from '../memory-store'
import type { JournalEntry } from '../model'
import specification from './spec.json' with { type: 'json' }
import { implementCommand } from '@specter-ts/core'

const store = createWorklogMemoryStore(() => ({
  journals: new Map<string, JournalEntry>(),
}))

export const editJournalEntry = implementCommand<'editJournalEntry'>(
  specification,
)
  .inputSchema(
    z
      .object({
        journalEntryId: z.string().min(1),
        body: z.string().min(1).max(10_000),
        activityAt: z.string().datetime({ offset: true }),
        editedAt: z.string().datetime({ offset: true }),
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
    if (!journal || journal.archived) throw new Error('Journal entry not found')
    const body = command.body.trim()
    if (!body) throw new Error('Journal entry body is required')
    return [journalEntryEditedEvent.create({ ...command, body })]
  })

import { z } from 'zod'

import { journalEntryAddedEvent, pointAwardedEvent } from '../events'
import { defineWorklogMemoryStore } from '../memory-store'
import specification from './spec.json' with { type: 'json' }
import { implementCommand } from '@specter-ts/core'
const store = defineWorklogMemoryStore(() => ({ ids: new Set<string>() }))

export const addJournalEntry = implementCommand(specification)
  .inputSchema(
    z
      .object({
        journalEntryId: z.string().min(1),
        body: z.string().min(1).max(10_000),
        activityAt: z.string().datetime({ offset: true }),
        createdAt: z.string().datetime({ offset: true }),
      })
      .strict(),
  )
  .store(store)
  .apply(journalEntryAddedEvent, async (event, state) => {
    state.ids.add(event.payload.journalEntryId)
  })
  .handle(async (command, state) => {
    if (state.ids.has(command.journalEntryId))
      throw new Error('Journal entry already exists')
    const body = command.body.trim()
    if (!body) throw new Error('Journal entry body is required')
    return [
      journalEntryAddedEvent.create({ ...command, body }),
      pointAwardedEvent.create({
        awardKey: `journal:${command.journalEntryId}:created`,
        reason: 'journal-added',
        points: 1,
        subject: { kind: 'journal', id: command.journalEntryId },
        related: [],
        awardedAt: command.createdAt,
      }),
    ]
  })

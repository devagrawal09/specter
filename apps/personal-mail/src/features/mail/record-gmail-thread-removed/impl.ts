import { implementCommand } from '@specter-ts/core'
import { z } from 'zod'

import { sqliteSliceStore } from '../../../db/specter-store'
import { gmailThreadRemovedEvent } from '../events'
import specification from './spec.json' with { type: 'json' }

export const recordGmailThreadRemoved = implementCommand(specification)
  .inputSchema(
    z.object({
      threadId: z.string().min(1),
      gmailHistoryId: z.string().min(1),
    }),
  )
  .store(sqliteSliceStore)
  .handle(async (command) => [gmailThreadRemovedEvent.create(command)])

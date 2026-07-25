import { implementCommand } from '@specter-ts/core'
import { z } from 'zod'

import { sqliteSliceStore } from '../../../db/specter-store'
import { gmailThreadRecordedEvent } from '../events'
import specification from './spec.json' with { type: 'json' }

const inputSchema = z.object({
  threadId: z.string().min(1),
  messageId: z.string().min(1),
  historyId: z.string().min(1),
  sender: z.string(),
  subject: z.string(),
  snippet: z.string(),
  bodyText: z.string(),
  receivedAt: z.string().min(1),
  unread: z.boolean(),
  labels: z.array(z.string()),
})

export const recordGmailThread = implementCommand(specification)
  .inputSchema(inputSchema)
  .store(sqliteSliceStore)
  .handle(async (command) => [gmailThreadRecordedEvent.create(command)])

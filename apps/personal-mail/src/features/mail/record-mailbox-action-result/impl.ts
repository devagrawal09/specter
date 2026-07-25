import { implementCommand } from '@specter-ts/core'
import { z } from 'zod'

import { sqliteSliceStore } from '../../../db/specter-store'
import {
  mailboxActionAppliedEvent,
  mailboxActionFailedEvent,
  mailboxActionReconciliationNeededEvent,
  mailboxActionSchema,
} from '../events'
import specification from './spec.json' with { type: 'json' }

export const recordMailboxActionResult = implementCommand(specification)
  .inputSchema(
    z.object({
      actionId: z.string().min(1),
      threadId: z.string().min(1),
      action: mailboxActionSchema,
      status: z.enum(['applied', 'failed', 'reconciliationNeeded']),
      gmailHistoryId: z.string(),
      reason: z.string(),
      occurredAt: z.string().min(1),
    }),
  )
  .store(sqliteSliceStore)
  .handle(async (command) => {
    const base = {
      actionId: command.actionId,
      threadId: command.threadId,
      action: command.action,
    }
    if (command.status === 'applied') {
      if (!command.gmailHistoryId) {
        throw new Error('Applied Gmail action requires a history ID')
      }
      return [
        mailboxActionAppliedEvent.create({
          ...base,
          gmailHistoryId: command.gmailHistoryId,
          appliedAt: command.occurredAt,
        }),
      ]
    }
    if (!command.reason)
      throw new Error('Unsuccessful Gmail action requires a reason')
    return command.status === 'failed'
      ? [
          mailboxActionFailedEvent.create({
            ...base,
            reason: command.reason,
            failedAt: command.occurredAt,
          }),
        ]
      : [
          mailboxActionReconciliationNeededEvent.create({
            ...base,
            reason: command.reason,
            detectedAt: command.occurredAt,
          }),
        ]
  })

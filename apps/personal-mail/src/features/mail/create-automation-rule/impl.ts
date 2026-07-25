import { implementCommand } from '@specter-ts/core'
import { z } from 'zod'

import { sqliteSliceStore } from '../../../db/specter-store'
import { automationRuleCreatedEvent, mailboxActionSchema } from '../events'
import specification from './spec.json' with { type: 'json' }

export const createAutomationRule = implementCommand(specification)
  .inputSchema(
    z.object({
      ruleId: z.string().min(1),
      name: z.string().min(1),
      senderContains: z.string(),
      subjectContains: z.string(),
      action: mailboxActionSchema,
      enabled: z.boolean(),
      createdAt: z.string().min(1),
    }),
  )
  .store(sqliteSliceStore)
  .handle(async (command) => {
    const senderContains = command.senderContains.trim()
    const subjectContains = command.subjectContains.trim()
    if (!senderContains && !subjectContains) {
      throw new Error('A rule must match a sender or subject')
    }
    return [
      automationRuleCreatedEvent.create({
        ...command,
        name: command.name.trim(),
        senderContains,
        subjectContains,
      }),
    ]
  })

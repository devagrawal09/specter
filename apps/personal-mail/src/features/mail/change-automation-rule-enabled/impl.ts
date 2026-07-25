import { eq } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { implementCommand } from '@specter-ts/core'
import { z } from 'zod'

import { sqliteSliceStore } from '../../../db/specter-store'
import {
  automationRuleCreatedEvent,
  automationRuleEnabledChangedEvent,
} from '../events'
import specification from './spec.json' with { type: 'json' }

export const ruleEnablementStates = sqliteTable('mail_rule_enablement_states', {
  ruleId: text('rule_id').primaryKey(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull(),
})

export const changeAutomationRuleEnabled = implementCommand(specification)
  .inputSchema(
    z.object({
      ruleId: z.string().min(1),
      enabled: z.boolean(),
      changedAt: z.string().min(1),
    }),
  )
  .store(sqliteSliceStore)
  .apply(automationRuleCreatedEvent, async (event, db) => {
    await db
      .insert(ruleEnablementStates)
      .values({ ruleId: event.payload.ruleId, enabled: event.payload.enabled })
      .onConflictDoUpdate({
        target: ruleEnablementStates.ruleId,
        set: { enabled: event.payload.enabled },
      })
      .run()
  })
  .apply(automationRuleEnabledChangedEvent, async (event, db) => {
    await db
      .update(ruleEnablementStates)
      .set({ enabled: event.payload.enabled })
      .where(eq(ruleEnablementStates.ruleId, event.payload.ruleId))
      .run()
  })
  .handle(async (command, db) => {
    const [rule] = await db
      .select()
      .from(ruleEnablementStates)
      .where(eq(ruleEnablementStates.ruleId, command.ruleId))
      .all()
    if (!rule) throw new Error('Automation rule is not known')
    if (rule.enabled === command.enabled) {
      throw new Error(
        command.enabled
          ? 'Automation rule is already enabled'
          : 'Automation rule is already disabled',
      )
    }
    return [automationRuleEnabledChangedEvent.create(command)]
  })

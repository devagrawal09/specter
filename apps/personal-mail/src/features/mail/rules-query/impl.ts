import { asc } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { implementQuery } from '@specter-ts/core'
import { z } from 'zod'

import { sqliteSliceStore } from '../../../db/specter-store'
import { automationRuleCreatedEvent, mailboxActionSchema } from '../events'
import specification from './spec.json' with { type: 'json' }

export const ruleProjection = sqliteTable('mail_rule_projection', {
  ruleId: text('rule_id').primaryKey(),
  name: text('name').notNull(),
  senderContains: text('sender_contains').notNull(),
  subjectContains: text('subject_contains').notNull(),
  action: text('action').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull(),
  createdAt: text('created_at').notNull(),
})

export const rulesQuery = implementQuery(specification)
  .inputSchema(z.object({}))
  .outputSchema(
    z.array(
      z.object({
        ruleId: z.string(),
        name: z.string(),
        senderContains: z.string(),
        subjectContains: z.string(),
        action: mailboxActionSchema,
        enabled: z.boolean(),
        createdAt: z.string(),
      }),
    ),
  )
  .store(sqliteSliceStore)
  .apply(automationRuleCreatedEvent, async (event, db) => {
    await db
      .insert(ruleProjection)
      .values(event.payload)
      .onConflictDoUpdate({ target: ruleProjection.ruleId, set: event.payload })
      .run()
  })
  .handle(async (_query, db) => {
    const rows = await db
      .select()
      .from(ruleProjection)
      .orderBy(asc(ruleProjection.createdAt))
      .all()
    return rows.map((row) => ({
      ...row,
      action: row.action as 'archive' | 'markRead' | 'star',
    }))
  })

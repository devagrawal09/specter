import { asc, eq } from 'drizzle-orm'
import { sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { implementReaction, type ReactionPlugin } from '@specter-ts/core'
import { z } from 'zod'

import { sqliteSliceStore } from '../../../db/specter-store'
import {
  mailboxActionAppliedEvent,
  mailboxActionFailedEvent,
  mailboxActionReconciliationNeededEvent,
  mailboxActionRequestedEvent,
  mailboxActionSchema,
} from '../events'
import { applyMailboxActionPlugin } from './plugin.server'
import specification from './spec.json' with { type: 'json' }

export type ApplyMailboxActionEffect = {
  actionId: string
  threadId: string
  action: 'archive' | 'markRead' | 'star'
  source: 'manual' | 'automation'
  authorizedByRuleId: string | null
}

export type ApplyMailboxActionOutput = {
  type: 'applyMailboxAction'
  payload: ApplyMailboxActionEffect
}

export const mailboxActionReactionStates = sqliteTable(
  'mailbox_action_reaction_states',
  {
    actionId: text('action_id').primaryKey(),
    threadId: text('thread_id').notNull(),
    action: text('action').notNull(),
    source: text('source').notNull().default('automation'),
    authorizedByRuleId: text('authorized_by_rule_id'),
    status: text('status').notNull(),
  },
)

export function createApplyMailboxActionReaction(
  plugin: ReactionPlugin<ApplyMailboxActionOutput> = applyMailboxActionPlugin,
) {
  return implementReaction(specification)
    .outputSchema(
      z.object({
        type: z.literal('applyMailboxAction'),
        payload: z.object({
          actionId: z.string(),
          threadId: z.string(),
          action: mailboxActionSchema,
          source: z.enum(['manual', 'automation']),
          authorizedByRuleId: z.string().nullable(),
        }),
      }),
    )
    .plugin(plugin)
    .store(sqliteSliceStore)
    .apply(mailboxActionRequestedEvent, async (event, db) => {
      await db
        .insert(mailboxActionReactionStates)
        .values({
          actionId: event.payload.actionId,
          threadId: event.payload.threadId,
          action: event.payload.action,
          source: event.payload.source,
          authorizedByRuleId: event.payload.authorizedByRuleId,
          status: 'pending',
        })
        .onConflictDoNothing()
        .run()
    })
    .apply(mailboxActionAppliedEvent, async (event, db) => {
      await updateStatus(db, event.payload.actionId, 'applied')
    })
    .apply(mailboxActionFailedEvent, async (event, db) => {
      await updateStatus(db, event.payload.actionId, 'failed')
    })
    .apply(mailboxActionReconciliationNeededEvent, async (event, db) => {
      await updateStatus(db, event.payload.actionId, 'reconciliationNeeded')
    })
    .handle(async (db) => {
      const rows = await db
        .select()
        .from(mailboxActionReactionStates)
        .where(eq(mailboxActionReactionStates.status, 'pending'))
        .orderBy(asc(mailboxActionReactionStates.actionId))
        .all()
      const action = rows[0]
      return action
        ? {
            type: 'applyMailboxAction' as const,
            payload: {
              actionId: action.actionId,
              threadId: action.threadId,
              action: action.action as 'archive' | 'markRead' | 'star',
              source: action.source as 'manual' | 'automation',
              authorizedByRuleId: action.authorizedByRuleId,
            },
          }
        : undefined
    })
}

export const applyMailboxActionReaction = createApplyMailboxActionReaction()

function updateStatus(
  db: import('../../../db/specter-sqlite').SqliteDb,
  actionId: string,
  status: string,
) {
  return db
    .update(mailboxActionReactionStates)
    .set({ status })
    .where(eq(mailboxActionReactionStates.actionId, actionId))
    .run()
}

import { asc, eq } from 'drizzle-orm'
import { sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { implementReaction } from '@specter-ts/core'
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
}

export const mailboxActionReactionStates = sqliteTable(
  'mailbox_action_reaction_states',
  {
    actionId: text('action_id').primaryKey(),
    threadId: text('thread_id').notNull(),
    action: text('action').notNull(),
    status: text('status').notNull(),
  },
)

export const applyMailboxActionReaction = implementReaction(specification)
  .outputSchema(
    z.object({
      type: z.literal('applyMailboxAction'),
      payload: z.object({
        actionId: z.string(),
        threadId: z.string(),
        action: mailboxActionSchema,
      }),
    }),
  )
  .plugin(applyMailboxActionPlugin)
  .store(sqliteSliceStore)
  .apply(mailboxActionRequestedEvent, async (event, db) => {
    await db
      .insert(mailboxActionReactionStates)
      .values({
        actionId: event.payload.actionId,
        threadId: event.payload.threadId,
        action: event.payload.action,
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
          },
        }
      : undefined
  })

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

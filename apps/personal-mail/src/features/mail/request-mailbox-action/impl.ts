import { eq } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { implementCommand } from '@specter-ts/core'
import { z } from 'zod'

import type { SqliteDb } from '../../../db/specter-sqlite'
import { sqliteSliceStore } from '../../../db/specter-store'
import {
  automationRuleCreatedEvent,
  gmailThreadRecordedEvent,
  mailboxActionAppliedEvent,
  mailboxActionFailedEvent,
  mailboxActionReconciliationNeededEvent,
  mailboxActionRequestedEvent,
  mailboxActionSchema,
} from '../events'
import specification from './spec.json' with { type: 'json' }

export const actionRequestThreads = sqliteTable('mail_action_request_threads', {
  threadId: text('thread_id').primaryKey(),
  sender: text('sender').notNull(),
  subject: text('subject').notNull(),
})

export const actionRequestRules = sqliteTable('mail_action_request_rules', {
  ruleId: text('rule_id').primaryKey(),
  senderContains: text('sender_contains').notNull(),
  subjectContains: text('subject_contains').notNull(),
  action: text('action').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull(),
})

export const actionRequestStates = sqliteTable('mail_action_request_states', {
  actionId: text('action_id').primaryKey(),
  threadId: text('thread_id').notNull(),
  status: text('status').notNull(),
})

export const requestMailboxAction = implementCommand(specification)
  .inputSchema(
    z.object({
      actionId: z.string().min(1),
      threadId: z.string().min(1),
      action: mailboxActionSchema,
      source: z.enum(['manual', 'automation']),
      authorizedByRuleId: z.string().min(1).nullable(),
      requestedAt: z.string().min(1),
    }),
  )
  .store(sqliteSliceStore)
  .apply(gmailThreadRecordedEvent, async (event, db) => {
    await db
      .insert(actionRequestThreads)
      .values({
        threadId: event.payload.threadId,
        sender: event.payload.sender,
        subject: event.payload.subject,
      })
      .onConflictDoUpdate({
        target: actionRequestThreads.threadId,
        set: { sender: event.payload.sender, subject: event.payload.subject },
      })
      .run()
  })
  .apply(automationRuleCreatedEvent, async (event, db) => {
    await db
      .insert(actionRequestRules)
      .values(event.payload)
      .onConflictDoUpdate({
        target: actionRequestRules.ruleId,
        set: {
          senderContains: event.payload.senderContains,
          subjectContains: event.payload.subjectContains,
          action: event.payload.action,
          enabled: event.payload.enabled,
        },
      })
      .run()
  })
  .apply(mailboxActionRequestedEvent, async (event, db) => {
    await db
      .insert(actionRequestStates)
      .values({
        actionId: event.payload.actionId,
        threadId: event.payload.threadId,
        status: 'requested',
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
  .handle(async (command, db) => {
    const [existing] = await db
      .select()
      .from(actionRequestStates)
      .where(eq(actionRequestStates.actionId, command.actionId))
      .all()
    if (existing) throw new Error('Mailbox action identity already exists')

    const [thread] = await db
      .select()
      .from(actionRequestThreads)
      .where(eq(actionRequestThreads.threadId, command.threadId))
      .all()
    if (!thread) throw new Error('Gmail thread is not known')

    if (command.source === 'manual') {
      if (command.authorizedByRuleId !== null) {
        throw new Error('Manual actions must not claim rule authorization')
      }
    } else {
      const ruleId = command.authorizedByRuleId
      const [rule] = ruleId
        ? await db
            .select()
            .from(actionRequestRules)
            .where(eq(actionRequestRules.ruleId, ruleId))
            .all()
        : []
      if (!rule || !ruleAuthorizes(rule, thread, command.action)) {
        throw new Error(
          'Automation rule does not authorize this thread and action',
        )
      }
    }

    return [
      mailboxActionRequestedEvent.create({
        actionId: command.actionId,
        threadId: command.threadId,
        action: command.action,
        source: command.source,
        authorizedByRuleId: command.authorizedByRuleId,
        requestedAt: command.requestedAt,
      }),
    ]
  })

function updateStatus(db: SqliteDb, actionId: string, status: string) {
  return db
    .update(actionRequestStates)
    .set({ status })
    .where(eq(actionRequestStates.actionId, actionId))
    .run()
}

function ruleAuthorizes(
  rule: typeof actionRequestRules.$inferSelect,
  thread: typeof actionRequestThreads.$inferSelect,
  action: string,
) {
  const senderMatches =
    !rule.senderContains ||
    thread.sender.toLowerCase().includes(rule.senderContains.toLowerCase())
  const subjectMatches =
    !rule.subjectContains ||
    thread.subject.toLowerCase().includes(rule.subjectContains.toLowerCase())
  return (
    rule.enabled && rule.action === action && senderMatches && subjectMatches
  )
}

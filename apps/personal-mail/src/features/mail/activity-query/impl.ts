import { desc } from 'drizzle-orm'
import { sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { implementQuery } from '@specter-ts/core'
import { z } from 'zod'

import type { SqliteDb } from '../../../db/specter-sqlite'
import { sqliteSliceStore } from '../../../db/specter-store'
import {
  mailboxActionAppliedEvent,
  mailboxActionFailedEvent,
  mailboxActionReconciliationNeededEvent,
  mailboxActionRequestedEvent,
  threadAnalyzedEvent,
  threadAnalysisRequestedEvent,
} from '../events'
import specification from './spec.json' with { type: 'json' }

export const activityProjection = sqliteTable('mail_activity_projection', {
  activityId: text('activity_id').primaryKey(),
  threadId: text('thread_id').notNull(),
  kind: text('kind').notNull(),
  status: text('status').notNull(),
  detail: text('detail').notNull(),
  occurredAt: text('occurred_at').notNull(),
})

export const activityQuery = implementQuery(specification)
  .inputSchema(z.object({ limit: z.number().int().min(1).max(100).catch(25) }))
  .outputSchema(
    z.array(
      z.object({
        activityId: z.string(),
        threadId: z.string(),
        kind: z.enum(['analysis', 'mailboxAction']),
        status: z.enum([
          'pending',
          'complete',
          'requested',
          'applied',
          'failed',
          'reconciliationNeeded',
        ]),
        detail: z.string(),
        occurredAt: z.string(),
      }),
    ),
  )
  .store(sqliteSliceStore)
  .apply(threadAnalysisRequestedEvent, async (event, db) => {
    await upsertActivity(db, {
      activityId: `analysis:${event.payload.analysisId}`,
      threadId: event.payload.threadId,
      kind: 'analysis',
      status: 'pending',
      detail: `${event.payload.provider}: analysis requested`,
      occurredAt: event.payload.requestedAt,
    })
  })
  .apply(threadAnalyzedEvent, async (event, db) => {
    await upsertActivity(db, {
      activityId: `analysis:${event.payload.analysisId}`,
      threadId: event.payload.threadId,
      kind: 'analysis',
      status: 'complete',
      detail: `${event.payload.provider}: ${event.payload.summary}`,
      occurredAt: event.payload.analyzedAt,
    })
  })
  .apply(mailboxActionRequestedEvent, async (event, db) => {
    await upsertActivity(db, {
      activityId: `action:${event.payload.actionId}`,
      threadId: event.payload.threadId,
      kind: 'mailboxAction',
      status: 'requested',
      detail: `${event.payload.action}: ${event.payload.source}`,
      occurredAt: event.payload.requestedAt,
    })
  })
  .apply(mailboxActionAppliedEvent, async (event, db) => {
    await upsertActivity(db, {
      activityId: `action:${event.payload.actionId}`,
      threadId: event.payload.threadId,
      kind: 'mailboxAction',
      status: 'applied',
      detail: `${event.payload.action}: Gmail history ${event.payload.gmailHistoryId}`,
      occurredAt: event.payload.appliedAt,
    })
  })
  .apply(mailboxActionFailedEvent, async (event, db) => {
    await upsertActivity(db, {
      activityId: `action:${event.payload.actionId}`,
      threadId: event.payload.threadId,
      kind: 'mailboxAction',
      status: 'failed',
      detail: `${event.payload.action}: ${event.payload.reason}`,
      occurredAt: event.payload.failedAt,
    })
  })
  .apply(mailboxActionReconciliationNeededEvent, async (event, db) => {
    await upsertActivity(db, {
      activityId: `action:${event.payload.actionId}`,
      threadId: event.payload.threadId,
      kind: 'mailboxAction',
      status: 'reconciliationNeeded',
      detail: `${event.payload.action}: ${event.payload.reason}`,
      occurredAt: event.payload.detectedAt,
    })
  })
  .handle(async (query, db) =>
    db
      .select()
      .from(activityProjection)
      .orderBy(desc(activityProjection.occurredAt))
      .limit(query.limit)
      .all()
      .then((rows) =>
        rows.map((row) => ({
          ...row,
          kind: row.kind as 'analysis' | 'mailboxAction',
          status: row.status as
            | 'pending'
            | 'complete'
            | 'requested'
            | 'applied'
            | 'failed'
            | 'reconciliationNeeded',
        })),
      ),
  )

function upsertActivity(
  db: SqliteDb,
  value: typeof activityProjection.$inferInsert,
) {
  return db
    .insert(activityProjection)
    .values(value)
    .onConflictDoUpdate({ target: activityProjection.activityId, set: value })
    .run()
}

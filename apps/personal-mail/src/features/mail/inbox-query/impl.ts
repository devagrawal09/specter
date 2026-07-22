import { desc, eq, like, or } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { implementQuery } from '@specter-ts/core'
import { z } from 'zod'

import { sqliteSliceStore } from '../../../db/specter-store'
import {
  gmailThreadRecordedEvent,
  mailboxActionAppliedEvent,
  threadAnalyzedEvent,
} from '../events'
import specification from './spec.json' with { type: 'json' }

export const inboxProjection = sqliteTable('mail_inbox_projection', {
  threadId: text('thread_id').primaryKey(),
  messageId: text('message_id').notNull(),
  historyId: text('history_id').notNull(),
  sender: text('sender').notNull(),
  subject: text('subject').notNull(),
  snippet: text('snippet').notNull(),
  bodyText: text('body_text').notNull(),
  receivedAt: text('received_at').notNull(),
  unread: integer('unread', { mode: 'boolean' }).notNull(),
  labelsJson: text('labels_json').notNull(),
  analysisId: text('analysis_id'),
  summary: text('summary'),
  priority: text('priority'),
  suggestedAction: text('suggested_action'),
  analysisProvider: text('analysis_provider'),
})

const analysisSchema = z.object({
  analysisId: z.string(),
  provider: z.enum(['local', 'cloud']),
  summary: z.string(),
  priority: z.enum(['low', 'normal', 'high']),
  suggestedAction: z.enum(['none', 'archive', 'markRead', 'star', 'reply']),
})

export const inboxQuery = implementQuery(specification)
  .inputSchema(
    z.object({
      filter: z.enum(['all', 'unread', 'high']).catch('all'),
      search: z.string().catch(''),
    }),
  )
  .outputSchema(
    z.array(
      z.object({
        threadId: z.string(),
        messageId: z.string(),
        historyId: z.string(),
        sender: z.string(),
        subject: z.string(),
        snippet: z.string(),
        bodyText: z.string(),
        receivedAt: z.string(),
        unread: z.boolean(),
        labels: z.array(z.string()),
        analysis: analysisSchema.nullable(),
      }),
    ),
  )
  .store(sqliteSliceStore)
  .apply(gmailThreadRecordedEvent, async (event, db) => {
    const payload = event.payload
    await db
      .insert(inboxProjection)
      .values({
        threadId: payload.threadId,
        messageId: payload.messageId,
        historyId: payload.historyId,
        sender: payload.sender,
        subject: payload.subject,
        snippet: payload.snippet,
        bodyText: payload.bodyText,
        receivedAt: payload.receivedAt,
        unread: payload.unread,
        labelsJson: JSON.stringify(payload.labels),
      })
      .onConflictDoUpdate({
        target: inboxProjection.threadId,
        set: {
          messageId: payload.messageId,
          historyId: payload.historyId,
          sender: payload.sender,
          subject: payload.subject,
          snippet: payload.snippet,
          bodyText: payload.bodyText,
          receivedAt: payload.receivedAt,
          unread: payload.unread,
          labelsJson: JSON.stringify(payload.labels),
        },
      })
      .run()
  })
  .apply(threadAnalyzedEvent, async (event, db) => {
    await db
      .update(inboxProjection)
      .set({
        analysisId: event.payload.analysisId,
        analysisProvider: event.payload.provider,
        summary: event.payload.summary,
        priority: event.payload.priority,
        suggestedAction: event.payload.suggestedAction,
      })
      .where(eq(inboxProjection.threadId, event.payload.threadId))
      .run()
  })
  .apply(mailboxActionAppliedEvent, async (event, db) => {
    const [row] = await db
      .select()
      .from(inboxProjection)
      .where(eq(inboxProjection.threadId, event.payload.threadId))
      .all()
    if (!row) return
    const labels = parseLabels(row.labelsJson)
    if (event.payload.action === 'archive') labels.delete('INBOX')
    if (event.payload.action === 'markRead') labels.delete('UNREAD')
    if (event.payload.action === 'star') labels.add('STARRED')
    await db
      .update(inboxProjection)
      .set({
        historyId: event.payload.gmailHistoryId,
        unread: labels.has('UNREAD'),
        labelsJson: JSON.stringify([...labels]),
      })
      .where(eq(inboxProjection.threadId, event.payload.threadId))
      .run()
  })
  .handle(async (query, db) => {
    const search = query.search.trim()
    const predicate = search
      ? or(
          like(inboxProjection.sender, `%${search}%`),
          like(inboxProjection.subject, `%${search}%`),
          like(inboxProjection.snippet, `%${search}%`),
        )
      : undefined
    const rows = await db
      .select()
      .from(inboxProjection)
      .where(predicate)
      .orderBy(desc(inboxProjection.receivedAt))
      .all()
    return rows
      .filter((row) =>
        query.filter === 'unread'
          ? row.unread
          : query.filter === 'high'
            ? row.priority === 'high'
            : true,
      )
      .map((row) => ({
        threadId: row.threadId,
        messageId: row.messageId,
        historyId: row.historyId,
        sender: row.sender,
        subject: row.subject,
        snippet: row.snippet,
        bodyText: row.bodyText,
        receivedAt: row.receivedAt,
        unread: row.unread,
        labels: [...parseLabels(row.labelsJson)],
        analysis:
          row.analysisId &&
          row.analysisProvider &&
          row.summary &&
          row.priority &&
          row.suggestedAction
            ? {
                analysisId: row.analysisId,
                provider: row.analysisProvider as 'local' | 'cloud',
                summary: row.summary,
                priority: row.priority as 'low' | 'normal' | 'high',
                suggestedAction: row.suggestedAction as
                  | 'none'
                  | 'archive'
                  | 'markRead'
                  | 'star'
                  | 'reply',
              }
            : null,
      }))
  })

function parseLabels(value: string) {
  const parsed = JSON.parse(value) as unknown
  return new Set(
    Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [],
  )
}

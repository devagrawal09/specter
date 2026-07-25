import { asc, eq } from 'drizzle-orm'
import { sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { implementReaction, type ReactionPlugin } from '@specter-ts/core'
import { z } from 'zod'

import { sqliteSliceStore } from '../../../db/specter-store'
import {
  gmailThreadRecordedEvent,
  threadAnalyzedEvent,
  threadAnalysisRequestedEvent,
} from '../events'
import { analyzeThreadPlugin } from './plugin.server'
import specification from './spec.json' with { type: 'json' }

export type AnalyzeThreadEffect = {
  analysisId: string
  threadId: string
  provider: 'local' | 'cloud'
  sender: string
  subject: string
  bodyText: string
}

export type AnalyzeThreadOutput = {
  type: 'analyzeThread'
  payload: AnalyzeThreadEffect
}

export const analysisReactionStates = sqliteTable(
  'mail_analysis_reaction_states',
  {
    analysisId: text('analysis_id').primaryKey(),
    threadId: text('thread_id').notNull(),
    provider: text('provider').notNull(),
    status: text('status').notNull(),
  },
)

export const analysisReactionThreads = sqliteTable(
  'mail_analysis_reaction_threads',
  {
    threadId: text('thread_id').primaryKey(),
    sender: text('sender').notNull(),
    subject: text('subject').notNull(),
    bodyText: text('body_text').notNull(),
  },
)

export function createAnalyzeThreadReaction(
  plugin: ReactionPlugin<AnalyzeThreadOutput> = analyzeThreadPlugin,
) {
  return implementReaction(specification)
    .outputSchema(
      z.object({
        type: z.literal('analyzeThread'),
        payload: z.object({
          analysisId: z.string(),
          threadId: z.string(),
          provider: z.enum(['local', 'cloud']),
          sender: z.string(),
          subject: z.string(),
          bodyText: z.string(),
        }),
      }),
    )
    .plugin(plugin)
    .store(sqliteSliceStore)
    .apply(gmailThreadRecordedEvent, async (event, db) => {
      await db
        .insert(analysisReactionThreads)
        .values({
          threadId: event.payload.threadId,
          sender: event.payload.sender,
          subject: event.payload.subject,
          bodyText: event.payload.bodyText,
        })
        .onConflictDoUpdate({
          target: analysisReactionThreads.threadId,
          set: {
            sender: event.payload.sender,
            subject: event.payload.subject,
            bodyText: event.payload.bodyText,
          },
        })
        .run()
    })
    .apply(threadAnalysisRequestedEvent, async (event, db) => {
      await db
        .insert(analysisReactionStates)
        .values({
          analysisId: event.payload.analysisId,
          threadId: event.payload.threadId,
          provider: event.payload.provider,
          status: 'pending',
        })
        .onConflictDoNothing()
        .run()
    })
    .apply(threadAnalyzedEvent, async (event, db) => {
      await db
        .update(analysisReactionStates)
        .set({ status: 'complete' })
        .where(eq(analysisReactionStates.analysisId, event.payload.analysisId))
        .run()
    })
    .handle(async (db) => {
      const pending = await db
        .select()
        .from(analysisReactionStates)
        .where(eq(analysisReactionStates.status, 'pending'))
        .orderBy(asc(analysisReactionStates.analysisId))
        .all()
      const request = pending[0]
      if (!request) return undefined
      const [thread] = await db
        .select()
        .from(analysisReactionThreads)
        .where(eq(analysisReactionThreads.threadId, request.threadId))
        .all()
      if (!thread) return undefined
      return {
        type: 'analyzeThread' as const,
        payload: {
          analysisId: request.analysisId,
          threadId: request.threadId,
          provider: request.provider as 'local' | 'cloud',
          sender: thread.sender,
          subject: thread.subject,
          bodyText: thread.bodyText,
        },
      }
    })
}

export const analyzeThreadReaction = createAnalyzeThreadReaction()

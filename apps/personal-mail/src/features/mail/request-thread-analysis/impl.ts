import { eq } from 'drizzle-orm'
import { sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { implementCommand } from '@specter-ts/core'
import { z } from 'zod'

import { sqliteSliceStore } from '../../../db/specter-store'
import {
  analysisProviderSchema,
  gmailThreadRecordedEvent,
  threadAnalyzedEvent,
  threadAnalysisRequestedEvent,
} from '../events'
import specification from './spec.json' with { type: 'json' }

export const analysisRequestStates = sqliteTable(
  'mail_analysis_request_states',
  {
    threadId: text('thread_id').primaryKey(),
    lastAnalysisId: text('last_analysis_id'),
    lastProvider: text('last_provider'),
    status: text('status').notNull(),
  },
)

export const requestThreadAnalysis = implementCommand(specification)
  .inputSchema(
    z.object({
      analysisId: z.string().min(1),
      threadId: z.string().min(1),
      provider: analysisProviderSchema,
      cloudOptIn: z.boolean(),
      requestedAt: z.string().min(1),
    }),
  )
  .store(sqliteSliceStore)
  .apply(gmailThreadRecordedEvent, async (event, db) => {
    await db
      .insert(analysisRequestStates)
      .values({ threadId: event.payload.threadId, status: 'idle' })
      .onConflictDoNothing()
      .run()
  })
  .apply(threadAnalysisRequestedEvent, async (event, db) => {
    await db
      .update(analysisRequestStates)
      .set({
        lastAnalysisId: event.payload.analysisId,
        lastProvider: event.payload.provider,
        status: 'pending',
      })
      .where(eq(analysisRequestStates.threadId, event.payload.threadId))
      .run()
  })
  .apply(threadAnalyzedEvent, async (event, db) => {
    await db
      .update(analysisRequestStates)
      .set({ status: 'complete' })
      .where(eq(analysisRequestStates.threadId, event.payload.threadId))
      .run()
  })
  .handle(async (command, db) => {
    const [state] = await db
      .select()
      .from(analysisRequestStates)
      .where(eq(analysisRequestStates.threadId, command.threadId))
      .all()
    if (!state) throw new Error('Gmail thread is not known')
    if (state.status === 'pending') {
      throw new Error('Thread analysis is already pending')
    }
    if (command.provider === 'cloud' && !command.cloudOptIn) {
      throw new Error('Cloud analysis requires explicit per-action opt-in')
    }
    return [
      threadAnalysisRequestedEvent.create({
        analysisId: command.analysisId,
        threadId: command.threadId,
        provider: command.provider,
        requestedAt: command.requestedAt,
      }),
    ]
  })

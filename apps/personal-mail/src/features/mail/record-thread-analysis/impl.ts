import { implementCommand } from '@specter-ts/core'
import { z } from 'zod'

import { sqliteSliceStore } from '../../../db/specter-store'
import { analysisProviderSchema, threadAnalyzedEvent } from '../events'
import specification from './spec.json' with { type: 'json' }

export const recordThreadAnalysis = implementCommand(specification)
  .inputSchema(
    z.object({
      analysisId: z.string().min(1),
      threadId: z.string().min(1),
      provider: analysisProviderSchema,
      summary: z.string().min(1),
      priority: z.enum(['low', 'normal', 'high']),
      suggestedAction: z.enum(['none', 'archive', 'markRead', 'star', 'reply']),
      analyzedAt: z.string().min(1),
    }),
  )
  .store(sqliteSliceStore)
  .handle(async (command) => [threadAnalyzedEvent.create(command)])

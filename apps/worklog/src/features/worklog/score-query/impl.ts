import { z } from 'zod'

import { pointAwardedEvent } from '../events'
import { defineWorklogMemoryStore } from '../memory-store'
import type { PointAward } from '../model'
import { scoreQuerySpec } from './spec'

const store = defineWorklogMemoryStore(() => ({ awards: [] as PointAward[] }))
const refSchema = z
  .object({ kind: z.enum(['journal', 'task', 'topic']), id: z.string() })
  .strict()
const awardSchema = z
  .object({
    awardKey: z.string(),
    reason: z.enum([
      'journal-added',
      'task-added',
      'topic-added',
      'connection-added',
      'task-first-completed',
      'completed-task-connection',
      'topic-all-tasks-completed',
    ]),
    points: z.literal(1),
    subject: z
      .object({
        kind: z.enum(['journal', 'task', 'topic', 'connection']),
        id: z.string(),
      })
      .strict(),
    related: z.array(refSchema),
    awardedAt: z.string(),
  })
  .strict()

export const scoreQuery = scoreQuerySpec
  .inputSchema(z.object({ limit: z.number().int().min(1).max(200) }).strict())
  .outputSchema(
    z
      .object({
        total: z.number().int().nonnegative(),
        awards: z.array(awardSchema),
      })
      .strict(),
  )
  .store(store)
  .apply(pointAwardedEvent, async (event, state) => {
    state.awards.push(event.payload)
  })
  .handle(async (query, state) => ({
    total: state.awards.reduce((sum, award) => sum + award.points, 0),
    awards: state.awards.slice(-query.limit).reverse(),
  }))

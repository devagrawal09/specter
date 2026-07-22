import { controlStore } from '../store'
import { z } from 'zod'

import { applyRunCreated, applyRunFrameRecorded, cloneRunFrame } from '../apply'
import { runCreatedEvent, runFrameRecordedEvent } from '../events'
import type { ColonyBenchRunFrameSummary } from '../state'
import specification from './spec.json' with { type: 'json' }
import { implementQuery } from '@specter-ts/core'
export const createRunTimeline = implementQuery(specification)
  .inputSchema(z.object({ runId: z.string() }))
  .outputSchema<ColonyBenchRunFrameSummary[]>()
  .store(controlStore)
  .apply(runCreatedEvent, applyRunCreated)
  .apply(runFrameRecordedEvent, applyRunFrameRecorded)
  .handle(async (query, state) =>
    (state.framesByRunId[query.runId] ?? []).map(cloneRunFrame),
  )

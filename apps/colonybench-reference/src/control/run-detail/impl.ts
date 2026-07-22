import { controlStore } from '../store'
import { z } from 'zod'

import { applyRunCompleted, applyRunCreated, applyRunStarted } from '../apply'
import { runCompletedEvent, runCreatedEvent, runStartedEvent } from '../events'
import type { ColonyBenchRun } from '../state'
import { runDetailSpec } from './spec'

export const createRunDetail = runDetailSpec
  .inputSchema(z.object({ runId: z.string() }))
  .outputSchema<ColonyBenchRun | null>()
  .store(controlStore)
  .apply(runCreatedEvent, applyRunCreated)
  .apply(runStartedEvent, applyRunStarted)
  .apply(runCompletedEvent, applyRunCompleted)
  .handle(async (query, state) => state.runs[query.runId] ?? null)

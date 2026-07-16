import type { SliceStoreAdapter } from '@specter-ts/core'
import { z } from 'zod'

import { applyRunCompleted, applyRunCreated, applyRunStarted } from '../apply'
import { runCompletedEvent, runCreatedEvent, runStartedEvent } from '../events'
import type { ColonyBenchControlState, ColonyBenchRun } from '../state'
import { runDetailSpec } from './spec'

export function createRunDetail(
  store: SliceStoreAdapter<ColonyBenchControlState>,
) {
  return runDetailSpec
    .inputSchema(z.object({ runId: z.string() }))
    .outputSchema<ColonyBenchRun | null>()
    .store(store)
    .apply(runCreatedEvent, applyRunCreated)
    .apply(runStartedEvent, applyRunStarted)
    .apply(runCompletedEvent, applyRunCompleted)
    .handle(async (query, state) => state.runs[query.runId] ?? null)
}

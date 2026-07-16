import type { SliceStoreAdapter } from '@specter-ts/core'
import { z } from 'zod'

import { applyRunCompleted, applyRunCreated, applyRunStarted } from '../apply'
import { runCompletedEvent, runCreatedEvent, runStartedEvent } from '../events'
import type { ColonyBenchControlState, ColonyBenchRun } from '../state'
import { runListSpec } from './spec'

export function createRunList(
  store: SliceStoreAdapter<ColonyBenchControlState>,
) {
  return runListSpec
    .inputSchema(z.object({}))
    .outputSchema<ColonyBenchRun[]>()
    .store(store)
    .apply(runCreatedEvent, applyRunCreated)
    .apply(runStartedEvent, applyRunStarted)
    .apply(runCompletedEvent, applyRunCompleted)
    .handle(async (_query, state) =>
      state.runOrder
        .map((runId) => state.runs[runId])
        .filter((run): run is ColonyBenchRun => Boolean(run)),
    )
}

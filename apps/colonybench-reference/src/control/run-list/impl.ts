import { controlStore } from '../store'
import { z } from 'zod'

import { applyRunCompleted, applyRunCreated, applyRunStarted } from '../apply'
import { runCompletedEvent, runCreatedEvent, runStartedEvent } from '../events'
import type { ColonyBenchRun } from '../state'
import { runListSpec } from './spec'

export const createRunList = runListSpec
  .inputSchema(z.object({}))
  .outputSchema<ColonyBenchRun[]>()
  .store(controlStore)
  .apply(runCreatedEvent, applyRunCreated)
  .apply(runStartedEvent, applyRunStarted)
  .apply(runCompletedEvent, applyRunCompleted)
  .handle(async (_query, state) =>
    state.runOrder
      .map((runId) => state.runs[runId])
      .filter((run): run is ColonyBenchRun => Boolean(run)),
  )

import type { SliceStoreAdapter } from '@specter-ts/core'
import { z } from 'zod'

import { applyRunCompleted, applyRunCreated, applyRunStarted } from '../apply'
import { runCompletedEvent, runCreatedEvent, runStartedEvent } from '../events'
import type { ColonyBenchControlState } from '../state'
import { startRunSpec } from './spec'

export function createStartRun(
  store: SliceStoreAdapter<ColonyBenchControlState>,
) {
  return startRunSpec
    .inputSchema(z.object({ runId: z.string() }))
    .store(store)
    .apply(runCreatedEvent, applyRunCreated)
    .apply(runStartedEvent, applyRunStarted)
    .apply(runCompletedEvent, applyRunCompleted)
    .handle(async (command, state) => {
      const run = state.runs[command.runId]
      if (!run) throw new Error(`Run not found: ${command.runId}`)
      if (run.status === 'started')
        throw new Error(`Run already started: ${command.runId}`)
      if (run.status === 'completed')
        throw new Error(`Run already completed: ${command.runId}`)
      return [runStartedEvent.create({ runId: command.runId })]
    })
}

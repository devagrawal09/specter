import type { SliceStoreAdapter } from '@specter-ts/core'
import { z } from 'zod'

import { applyRunCompleted, applyRunCreated, applyRunStarted } from '../apply'
import { runCompletedEvent, runCreatedEvent, runStartedEvent } from '../events'
import type { ColonyBenchControlState } from '../state'
import specification from './spec.json' with { type: 'json' }
import { implementCommand } from '@specter-ts/core'

export function createCompleteRun(
  store: SliceStoreAdapter<ColonyBenchControlState>,
) {
  return implementCommand<'completeRun'>(specification)
    .inputSchema(z.object({ runId: z.string() }))
    .store(store)
    .apply(runCreatedEvent, applyRunCreated)
    .apply(runStartedEvent, applyRunStarted)
    .apply(runCompletedEvent, applyRunCompleted)
    .handle(async (command, state) => {
      const run = state.runs[command.runId]
      if (!run) throw new Error(`Run not found: ${command.runId}`)
      if (run.status !== 'started')
        throw new Error(`Run not started: ${command.runId}`)
      return [runCompletedEvent.create({ runId: command.runId })]
    })
}

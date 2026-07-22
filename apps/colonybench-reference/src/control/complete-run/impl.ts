import { controlStore } from '../store'
import { z } from 'zod'

import { applyRunCompleted, applyRunCreated, applyRunStarted } from '../apply'
import { runCompletedEvent, runCreatedEvent, runStartedEvent } from '../events'
import { completeRunSpec } from './spec'

export const createCompleteRun = completeRunSpec
  .inputSchema(z.object({ runId: z.string() }))
  .store(controlStore)
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

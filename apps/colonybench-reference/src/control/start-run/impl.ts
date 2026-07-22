import { controlStore } from '../store'
import { z } from 'zod'

import { applyRunCompleted, applyRunCreated, applyRunStarted } from '../apply'
import { runCompletedEvent, runCreatedEvent, runStartedEvent } from '../events'
import specification from './spec.json' with { type: 'json' }
import { implementCommand } from '@specter-ts/core'
export const createStartRun = implementCommand(specification)
  .inputSchema(z.object({ runId: z.string() }))
  .store(controlStore)
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

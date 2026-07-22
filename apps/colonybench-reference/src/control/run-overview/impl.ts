import { controlStore } from '../store'
import { z } from 'zod'

import {
  applyRunCompleted,
  applyRunCreated,
  applyRunFrameRecorded,
  applyRunStarted,
  cloneRunFrame,
} from '../apply'
import {
  runCompletedEvent,
  runCreatedEvent,
  runFrameRecordedEvent,
  runStartedEvent,
} from '../events'
import type { ColonyBenchRunOverview } from '../state'
import { runOverviewSpec } from './spec'

export const createRunOverview = runOverviewSpec
  .inputSchema(z.object({ runId: z.string() }))
  .outputSchema<ColonyBenchRunOverview>()
  .store(controlStore)
  .apply(runCreatedEvent, applyRunCreated)
  .apply(runStartedEvent, applyRunStarted)
  .apply(runFrameRecordedEvent, applyRunFrameRecorded)
  .apply(runCompletedEvent, applyRunCompleted)
  .handle(async (query, state) => {
    const run = state.runs[query.runId]
    const frames = state.framesByRunId[query.runId] ?? []
    const latestFrame = frames[frames.length - 1]
    return {
      run: run ? { ...run } : null,
      frameCount: frames.length,
      latestFrame: latestFrame ? cloneRunFrame(latestFrame) : null,
    }
  })

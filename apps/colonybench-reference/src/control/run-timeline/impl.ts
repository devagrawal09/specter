import type { SliceStoreAdapter } from '@specter-ts/core'
import { z } from 'zod'

import { applyRunCreated, applyRunFrameRecorded, cloneRunFrame } from '../apply'
import { runCreatedEvent, runFrameRecordedEvent } from '../events'
import type {
  ColonyBenchControlState,
  ColonyBenchRunFrameSummary,
} from '../state'
import { runTimelineSpec } from './spec'

export function createRunTimeline(
  store: SliceStoreAdapter<ColonyBenchControlState>,
) {
  return runTimelineSpec
    .inputSchema(z.object({ runId: z.string() }))
    .outputSchema<ColonyBenchRunFrameSummary[]>()
    .store(store)
    .apply(runCreatedEvent, applyRunCreated)
    .apply(runFrameRecordedEvent, applyRunFrameRecorded)
    .handle(async (query, state) =>
      (state.framesByRunId[query.runId] ?? []).map(cloneRunFrame),
    )
}

import type { SliceStoreAdapter } from '@specter-ts/core'
import { z } from 'zod'

import { applyRunCreated, applyRunFrameRecorded, cloneRunFrame } from '../apply'
import { runCreatedEvent, runFrameRecordedEvent } from '../events'
import type {
  ColonyBenchControlState,
  ColonyBenchRunFrameSummary,
} from '../state'
import specification from './spec.json' with { type: 'json' }
import { implementQuery } from '@specter-ts/core'

export function createRunTimeline(
  store: SliceStoreAdapter<ColonyBenchControlState>,
) {
  return implementQuery<'runTimeline'>(specification)
    .inputSchema(z.object({ runId: z.string() }))
    .outputSchema<ColonyBenchRunFrameSummary[]>()
    .store(store)
    .apply(runCreatedEvent, applyRunCreated)
    .apply(runFrameRecordedEvent, applyRunFrameRecorded)
    .handle(async (query, state) =>
      (state.framesByRunId[query.runId] ?? []).map(cloneRunFrame),
    )
}

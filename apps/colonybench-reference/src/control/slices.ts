import type { SliceStoreAdapter } from '@specter-ts/core'

import { createCompleteRun } from './complete-run/impl'
import { createCreateRun } from './create-run/impl'
import { createRecordRunFrame } from './record-run-frame/impl'
import { createRunDetail } from './run-detail/impl'
import { createRunList } from './run-list/impl'
import { createRunOverview } from './run-overview/impl'
import { createRunTimeline } from './run-timeline/impl'
import { createStartRun } from './start-run/impl'
import type { ColonyBenchControlState } from './state'

export function createControlSlices(
  store: SliceStoreAdapter<ColonyBenchControlState>,
) {
  return [
    createCreateRun(store),
    createStartRun(store),
    createCompleteRun(store),
    createRecordRunFrame(store),
    createRunDetail(store),
    createRunList(store),
    createRunTimeline(store),
    createRunOverview(store),
  ] as const
}

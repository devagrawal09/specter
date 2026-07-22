import { createCompleteRun } from './complete-run/impl'
import { createCreateRun } from './create-run/impl'
import { createRecordRunFrame } from './record-run-frame/impl'
import { createRunDetail } from './run-detail/impl'
import { createRunList } from './run-list/impl'
import { createRunOverview } from './run-overview/impl'
import { createRunTimeline } from './run-timeline/impl'
import { createStartRun } from './start-run/impl'
export const controlSlices = {
  createRun: createCreateRun,
  startRun: createStartRun,
  completeRun: createCompleteRun,
  recordRunFrame: createRecordRunFrame,
  runDetail: createRunDetail,
  runList: createRunList,
  runTimeline: createRunTimeline,
  runOverview: createRunOverview,
} as const

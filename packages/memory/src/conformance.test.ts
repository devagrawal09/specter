import {
  testEventLogAdapter,
  testReactionScheduler,
  testSliceStoreAdapter,
} from '@specter-ts/core/testing'

import { createMemoryEventLog } from './event-log'
import { createImmediateReactionScheduler } from './reaction-scheduler'
import { createMemorySliceStore } from './slice-store'

testEventLogAdapter('memory', createMemoryEventLog)

testSliceStoreAdapter('memory', {
  createAdapter: () => createMemorySliceStore(() => ({ value: 0 })),
  write: (state, value: number) => {
    state.value = value
  },
  read: (state) => state.value,
  value: 42,
})

testReactionScheduler('memory', createImmediateReactionScheduler)

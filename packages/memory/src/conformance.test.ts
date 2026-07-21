import {
  testEventLogAdapter,
  testReactionScheduler,
  testSliceStoreService,
} from '@specter-ts/core/testing'

import { createMemoryEventLog } from './event-log'
import { createImmediateReactionScheduler } from './reaction-scheduler'
import { createMemorySliceStoreService } from './slice-store'

testEventLogAdapter('memory', createMemoryEventLog)

testSliceStoreService('memory', {
  createService: () => createMemorySliceStoreService(() => ({ value: 0 })),
  write: (state, value: number) => {
    state.value = value
  },
  read: (state) => state.value,
  value: 42,
})

testReactionScheduler('memory', createImmediateReactionScheduler)

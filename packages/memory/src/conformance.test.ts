import {
  testEventLogService,
  testSliceStoreService,
} from '@specter-ts/core/testing'

import { createMemoryEventLog } from './event-log'
import { createMemorySliceStoreService } from './slice-store'

testEventLogService('memory', createMemoryEventLog)

testSliceStoreService('memory', {
  createService: () => createMemorySliceStoreService(() => ({ value: 0 })),
  write: async (state, value: number) => {
    state.value = value
  },
  read: async (state) => state.value,
  value: 42,
})

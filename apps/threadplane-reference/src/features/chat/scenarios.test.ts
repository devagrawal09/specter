import { testScenarios } from '@specter-ts/core/testing'

import { resetMemorySliceStores } from '../../testing/memory-slice-store'
import { chatRegistrations } from './registry'

testScenarios(chatRegistrations, {
  runScenario: async (run) => {
    resetMemorySliceStores()
    return run()
  },
})

import { testSliceImplementations } from '@specter-ts/core/testing'

import { worklogEventDefinitions } from './events'
import { resetWorklogMemoryStores } from './memory-store'
import { worklogRegistrations } from './registry'

testSliceImplementations(worklogRegistrations, {
  events: worklogEventDefinitions,
  runScenario: async <T>(run: () => Promise<T>) => {
    resetWorklogMemoryStores()
    return run()
  },
})

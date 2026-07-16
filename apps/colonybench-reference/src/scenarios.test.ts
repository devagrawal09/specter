import { testSliceImplementations } from '@specter-ts/core/testing'

import {
  runCompletedEvent,
  runCreatedEvent,
  runFrameRecordedEvent,
  runStartedEvent,
} from './control/events'
import { createControlSlices } from './control/slices'
import { createColonyBenchControlState } from './control/state'
import {
  baseUpgradedEvent,
  commandRejectedEvent,
  constructionSiteBuiltEvent,
  roadCompletedEvent,
  roadRepairedEvent,
  simulationInitializedEvent,
  tickAdvancedEvent,
  workerDepositedEvent,
  workerHarvestedEvent,
  workerMovedEvent,
  workerSpawnedEvent,
} from './simulation/events'
import { createSimulationSlices } from './simulation/slices'
import { createColonyBenchSimulationState } from './simulation/state'
import { createMemorySliceStore } from './testing/memory-slice-store'

const controlStore = createMemorySliceStore(createColonyBenchControlState)
const simulationStore = createMemorySliceStore(createColonyBenchSimulationState)

testSliceImplementations(createControlSlices(controlStore), {
  events: [
    runCreatedEvent,
    runStartedEvent,
    runCompletedEvent,
    runFrameRecordedEvent,
  ],
  runScenario: async (run) => {
    controlStore.reset()
    return await run()
  },
})

testSliceImplementations(createSimulationSlices(simulationStore), {
  events: [
    simulationInitializedEvent,
    workerMovedEvent,
    workerHarvestedEvent,
    workerDepositedEvent,
    baseUpgradedEvent,
    workerSpawnedEvent,
    constructionSiteBuiltEvent,
    roadCompletedEvent,
    roadRepairedEvent,
    commandRejectedEvent,
    tickAdvancedEvent,
  ],
  runScenario: async (run) => {
    simulationStore.reset()
    return await run()
  },
})

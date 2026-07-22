import { testSliceImplementations } from '@specter-ts/core/testing'
import { createMemorySliceStoreService } from '@specter-ts/memory'
import { Effect, Layer } from 'effect'

import {
  runCompletedEvent,
  runCreatedEvent,
  runFrameRecordedEvent,
  runStartedEvent,
} from './control/events'
import { controlSlices } from './control/slices'
import { createColonyBenchControlState } from './control/state'
import { ColonyBenchControlStore } from './control/store'
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
import { simulationSlices } from './simulation/slices'
import { createColonyBenchSimulationState } from './simulation/state'
import { ColonyBenchSimulationStore } from './simulation/store'

const controlStore = createMemorySliceStoreService(
  createColonyBenchControlState,
)
const simulationStore = createMemorySliceStoreService(
  createColonyBenchSimulationState,
)

testSliceImplementations(controlSlices, {
  events: [
    runCreatedEvent,
    runStartedEvent,
    runCompletedEvent,
    runFrameRecordedEvent,
  ],
  runScenario: async <T>(program: Effect.Effect<T, unknown, unknown>) => {
    controlStore.reset()
    return Effect.runPromise(
      program.pipe(
        Effect.provide(Layer.succeed(ColonyBenchControlStore, controlStore)),
      ) as Effect.Effect<T, unknown, never>,
    )
  },
})

testSliceImplementations(simulationSlices, {
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
  runScenario: async <T>(program: Effect.Effect<T, unknown, unknown>) => {
    simulationStore.reset()
    return Effect.runPromise(
      program.pipe(
        Effect.provide(
          Layer.succeed(ColonyBenchSimulationStore, simulationStore),
        ),
      ) as Effect.Effect<T, unknown, never>,
    )
  },
})

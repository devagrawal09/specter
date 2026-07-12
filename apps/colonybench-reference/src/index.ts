import {
  createSpecterApp,
  type EventLogAdapter,
  type ReactionScheduler,
  type SliceStoreAdapter,
  type SpecterApp,
} from "@specter-ts/core"

import { controlEventDefinitions } from "./control/events"
import { createControlSlices } from "./control/slices"
import {
  createColonyBenchControlState,
  type ColonyBenchControlState,
} from "./control/state"
import { simulationEventDefinitions } from "./simulation/events"
import { createSimulationSlices } from "./simulation/slices"
import {
  createColonyBenchSimulationState,
  type ColonyBenchSimulationState,
} from "./simulation/state"
import { createMemoryEventLog } from "./testing/memory-event-log"
import { memoryReactionScheduler } from "./testing/memory-reaction-scheduler"
import { createMemorySliceStore } from "./testing/memory-slice-store"

export type ColonyBenchControlAdapters = {
  eventLog: EventLogAdapter
  store: SliceStoreAdapter<ColonyBenchControlState>
  schedule: ReactionScheduler
}

export type ColonyBenchSimulationAdapters = {
  eventLog: EventLogAdapter
  store: SliceStoreAdapter<ColonyBenchSimulationState>
  schedule: ReactionScheduler
}

export function createMemoryColonyBenchControlAdapters(): ColonyBenchControlAdapters {
  return {
    eventLog: createMemoryEventLog(),
    store: createMemorySliceStore(createColonyBenchControlState),
    schedule: memoryReactionScheduler,
  }
}

export function createMemoryColonyBenchSimulationAdapters(): ColonyBenchSimulationAdapters {
  return {
    eventLog: createMemoryEventLog(),
    store: createMemorySliceStore(createColonyBenchSimulationState),
    schedule: memoryReactionScheduler,
  }
}

export function createColonyBenchSimulationApp({
  adapters,
}: {
  adapters: ColonyBenchSimulationAdapters
}) {
  return createSpecterApp({
    events: simulationEventDefinitions,
    eventLog: adapters.eventLog,
    schedule: adapters.schedule,
    slices: createSimulationSlices(adapters.store),
  })
}

export type ColonyBenchSimulationApp = ReturnType<
  typeof createColonyBenchSimulationApp
>

export type ColonyBenchControlBridge = {
  runStarted: (input: { runId: string }) => Promise<void>
}

export function connectControlRunStartedToSimulation(
  simulationApp: ColonyBenchSimulationApp,
): ColonyBenchControlBridge {
  return {
    async runStarted({ runId }) {
      await simulationApp.initializeSimulation({ runId })
    },
  }
}

export function createColonyBenchControlApp({
  adapters,
  bridge,
}: {
  adapters: ColonyBenchControlAdapters
  bridge?: ColonyBenchControlBridge
}) {
  const app = createSpecterApp({
    events: controlEventDefinitions,
    eventLog: adapters.eventLog,
    schedule: adapters.schedule,
    slices: createControlSlices(adapters.store),
  })

  if (!bridge) return app

  return {
    ...app,
    async startRun(input: { runId: string }) {
      await app.startRun(input)
      await bridge.runStarted(input)
    },
  } satisfies typeof app
}

export type ColonyBenchControlApp = SpecterApp<{
  events: typeof controlEventDefinitions
  eventLog: EventLogAdapter
  schedule: ReactionScheduler
  slices: ReturnType<typeof createControlSlices>
}>

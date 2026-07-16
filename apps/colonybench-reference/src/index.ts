import {
  createSpecterApp,
  type EventLogAdapter,
  type ReactionScheduler,
  type SliceStoreAdapter,
  type SpecterApp,
} from '@specter-ts/core'

import { controlEventDefinitions } from './control/events'
import { createControlSlices } from './control/slices'
import {
  createColonyBenchControlState,
  type ColonyBenchControlState,
} from './control/state'
import { simulationEventDefinitions } from './simulation/events'
import { createSimulationSlices } from './simulation/slices'
import {
  createColonyBenchSimulationState,
  type ColonyBenchSimulationState,
} from './simulation/state'
import { createMemoryEventLog } from './testing/memory-event-log'
import { memoryReactionScheduler } from './testing/memory-reaction-scheduler'
import { createMemorySliceStore } from './testing/memory-slice-store'

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

export async function createColonyBenchSimulationApp({
  adapters,
}: {
  adapters: ColonyBenchSimulationAdapters
}) {
  return await createSpecterApp({
    events: simulationEventDefinitions,
    eventLog: adapters.eventLog,
    schedule: adapters.schedule,
    slices: createSimulationSlices(adapters.store),
  })
}

export type ColonyBenchSimulationApp = Awaited<
  ReturnType<typeof createColonyBenchSimulationApp>
>

export type ColonyBenchControlBridge = {
  runStarted: (input: { runId: string }) => Promise<void>
}

export function connectControlRunStartedToSimulation(
  simulationApp: ColonyBenchSimulationApp,
): ColonyBenchControlBridge {
  return {
    async runStarted({ runId }) {
      const execution = await simulationApp.command({
        type: 'initializeSimulation',
        payload: { runId },
      })
      await execution.reactions
    },
  }
}

export async function createColonyBenchControlApp({
  adapters,
  bridge,
}: {
  adapters: ColonyBenchControlAdapters
  bridge?: ColonyBenchControlBridge
}) {
  const app = await createSpecterApp({
    events: controlEventDefinitions,
    eventLog: adapters.eventLog,
    schedule: adapters.schedule,
    slices: createControlSlices(adapters.store),
  })

  if (!bridge) return app

  const command: typeof app.command = async (envelope, options) => {
    const execution = await app.command(envelope, options)
    if (envelope.type !== 'startRun') return execution

    return {
      ...execution,
      reactions: Promise.all([
        execution.reactions,
        bridge.runStarted(envelope.payload as { runId: string }),
      ]).then(() => undefined),
    }
  }

  return Object.freeze({ ...app, command })
}

export type ColonyBenchControlApp = SpecterApp<{
  events: typeof controlEventDefinitions
  eventLog: EventLogAdapter
  schedule: ReactionScheduler
  slices: ReturnType<typeof createControlSlices>
}>

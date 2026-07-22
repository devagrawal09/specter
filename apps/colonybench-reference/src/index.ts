import { createSpecterApp, type SpecterApp } from '@specter-ts/core'
import {
  createMemoryEventLogLayer,
  createMemorySliceStoreLayer,
} from '@specter-ts/memory'
import { Layer } from 'effect'

import { controlEventDefinitions } from './control/events'
import { controlSlices } from './control/slices'
import { createColonyBenchControlState } from './control/state'
import { ColonyBenchControlStore } from './control/store'
import { simulationEventDefinitions } from './simulation/events'
import { simulationSlices } from './simulation/slices'
import { createColonyBenchSimulationState } from './simulation/state'
import { ColonyBenchSimulationStore } from './simulation/store'

const controlConfig = {
  events: controlEventDefinitions,
  slices: controlSlices,
} as const

const simulationConfig = {
  events: simulationEventDefinitions,
  slices: simulationSlices,
} as const

export function createMemoryColonyBenchControlAdapters() {
  return Layer.mergeAll(
    createMemoryEventLogLayer(),
    createMemorySliceStoreLayer(
      ColonyBenchControlStore,
      createColonyBenchControlState,
    ),
  )
}

export type ColonyBenchControlAdapters = ReturnType<
  typeof createMemoryColonyBenchControlAdapters
>

export function createMemoryColonyBenchSimulationAdapters() {
  return Layer.mergeAll(
    createMemoryEventLogLayer(),
    createMemorySliceStoreLayer(
      ColonyBenchSimulationStore,
      createColonyBenchSimulationState,
    ),
  )
}

export type ColonyBenchSimulationAdapters = ReturnType<
  typeof createMemoryColonyBenchSimulationAdapters
>

export async function createColonyBenchSimulationApp({
  adapters,
}: {
  adapters: ColonyBenchSimulationAdapters
}) {
  return createSpecterApp(simulationConfig, adapters)
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
  const app = await createSpecterApp(controlConfig, adapters)
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

export type ColonyBenchControlApp = SpecterApp<typeof controlConfig>

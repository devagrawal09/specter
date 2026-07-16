import type { SliceStoreAdapter } from '@specter-ts/core'

import { simulationInitializedEvent } from '../events'
import { runIdSchema } from '../shared'
import type { ColonyBenchSimulationState } from '../state'
import { initializeSimulationSpec } from './spec'

export function createInitializeSimulation(
  store: SliceStoreAdapter<ColonyBenchSimulationState>,
) {
  return initializeSimulationSpec
    .inputSchema(runIdSchema)
    .store(store)
    .handle(async (command) => [simulationInitializedEvent.create(command)])
}

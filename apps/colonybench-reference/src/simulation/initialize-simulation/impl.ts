import type { SliceStoreAdapter } from '@specter-ts/core'

import { simulationInitializedEvent } from '../events'
import { runIdSchema } from '../shared'
import type { ColonyBenchSimulationState } from '../state'
import specification from './spec.json' with { type: 'json' }
import { implementCommand } from '@specter-ts/core'

export function createInitializeSimulation(
  store: SliceStoreAdapter<ColonyBenchSimulationState>,
) {
  return implementCommand<'initializeSimulation'>(specification)
    .inputSchema(runIdSchema)
    .store(store)
    .handle(async (command) => [simulationInitializedEvent.create(command)])
}

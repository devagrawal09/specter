import { simulationStore } from '../store'

import { simulationInitializedEvent } from '../events'
import { runIdSchema } from '../shared'
import { initializeSimulationSpec } from './spec'

export const createInitializeSimulation = initializeSimulationSpec
  .inputSchema(runIdSchema)
  .store(simulationStore)
  .handle(async (command) => [simulationInitializedEvent.create(command)])

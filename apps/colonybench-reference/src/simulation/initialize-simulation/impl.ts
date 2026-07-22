import { simulationStore } from '../store'

import { simulationInitializedEvent } from '../events'
import { runIdSchema } from '../shared'
import specification from './spec.json' with { type: 'json' }
import { implementCommand } from '@specter-ts/core'
export const createInitializeSimulation = implementCommand(specification)
  .inputSchema(runIdSchema)
  .store(simulationStore)
  .handle(async (command) => [simulationInitializedEvent.create(command)])

import { simulationStore } from '../store'

import { applySimulationInitialized } from '../apply'
import { simulationInitializedEvent } from '../events'
import { runIdSchema } from '../shared'
import type { ColonyBenchSimulationStatus } from '../state'
import specification from './spec.json' with { type: 'json' }
import { implementQuery } from '@specter-ts/core'
export const createLiveSimulationStatus = implementQuery(specification)
  .inputSchema(runIdSchema)
  .outputSchema<ColonyBenchSimulationStatus>()
  .store(simulationStore)
  .apply(simulationInitializedEvent, applySimulationInitialized)
  .handle(async (query, state) => ({
    runId: query.runId,
    initialized: Boolean(state.worlds[query.runId]),
    status: state.worlds[query.runId] ? 'initialized' : 'missing',
  }))

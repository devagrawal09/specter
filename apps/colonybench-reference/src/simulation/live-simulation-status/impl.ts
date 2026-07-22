import { simulationStore } from '../store'

import { applySimulationInitialized } from '../apply'
import { simulationInitializedEvent } from '../events'
import { runIdSchema } from '../shared'
import type { ColonyBenchSimulationStatus } from '../state'
import { liveSimulationStatusSpec } from './spec'

export const createLiveSimulationStatus = liveSimulationStatusSpec
  .inputSchema(runIdSchema)
  .outputSchema<ColonyBenchSimulationStatus>()
  .store(simulationStore)
  .apply(simulationInitializedEvent, applySimulationInitialized)
  .handle(async (query, state) => ({
    runId: query.runId,
    initialized: Boolean(state.worlds[query.runId]),
    status: state.worlds[query.runId] ? 'initialized' : 'missing',
  }))

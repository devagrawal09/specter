import type { SliceStoreAdapter } from '@specter-ts/core'

import { applySimulationInitialized } from '../apply'
import { simulationInitializedEvent } from '../events'
import { runIdSchema } from '../shared'
import type {
  ColonyBenchSimulationState,
  ColonyBenchSimulationStatus,
} from '../state'
import specification from './spec.json' with { type: 'json' }
import { implementQuery } from '@specter-ts/core'

export function createLiveSimulationStatus(
  store: SliceStoreAdapter<ColonyBenchSimulationState>,
) {
  return implementQuery<'liveSimulationStatus'>(specification)
    .inputSchema(runIdSchema)
    .outputSchema<ColonyBenchSimulationStatus>()
    .store(store)
    .apply(simulationInitializedEvent, applySimulationInitialized)
    .handle(async (query, state) => ({
      runId: query.runId,
      initialized: Boolean(state.worlds[query.runId]),
      status: state.worlds[query.runId] ? 'initialized' : 'missing',
    }))
}

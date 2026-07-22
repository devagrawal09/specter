import type { SliceStoreAdapter } from '@specter-ts/core'

import {
  applyBaseUpgraded,
  applyCommandRejected,
  applyConstructionSiteBuilt,
  applyRoadCompleted,
  applyRoadRepaired,
  applySimulationInitialized,
  applyTickAdvanced,
  applyWorkerDeposited,
  applyWorkerHarvested,
  applyWorkerMoved,
  applyWorkerSpawned,
} from '../apply'
import {
  baseUpgradedEvent,
  commandRejectedEvent,
  constructionSiteBuiltEvent,
  roadCompletedEvent,
  roadRepairedEvent,
  simulationInitializedEvent,
  tickAdvancedEvent,
  workerDepositedEvent,
  workerHarvestedEvent,
  workerMovedEvent,
  workerSpawnedEvent,
} from '../events'
import { runIdSchema } from '../shared'
import {
  snapshotWorld,
  type ColonyBenchSimulationState,
  type ColonyBenchWorldSnapshot,
} from '../state'
import specification from './spec.json' with { type: 'json' }
import { implementQuery } from '@specter-ts/core'

export function createLiveWorldSnapshot(
  store: SliceStoreAdapter<ColonyBenchSimulationState>,
) {
  return implementQuery<'liveWorldSnapshot'>(specification)
    .inputSchema(runIdSchema)
    .outputSchema<ColonyBenchWorldSnapshot>()
    .store(store)
    .apply(simulationInitializedEvent, applySimulationInitialized)
    .apply(workerMovedEvent, applyWorkerMoved)
    .apply(workerHarvestedEvent, applyWorkerHarvested)
    .apply(workerDepositedEvent, applyWorkerDeposited)
    .apply(baseUpgradedEvent, applyBaseUpgraded)
    .apply(workerSpawnedEvent, applyWorkerSpawned)
    .apply(constructionSiteBuiltEvent, applyConstructionSiteBuilt)
    .apply(roadCompletedEvent, applyRoadCompleted)
    .apply(roadRepairedEvent, applyRoadRepaired)
    .apply(commandRejectedEvent, applyCommandRejected)
    .apply(tickAdvancedEvent, applyTickAdvanced)
    .handle(async (query, state) =>
      snapshotWorld(query.runId, state.worlds[query.runId]),
    )
}

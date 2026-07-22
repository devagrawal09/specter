import { simulationStore } from '../store'

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
import { snapshotWorld, type ColonyBenchWorldSnapshot } from '../state'
import { liveWorldSnapshotSpec } from './spec'

export const createLiveWorldSnapshot = liveWorldSnapshotSpec
  .inputSchema(runIdSchema)
  .outputSchema<ColonyBenchWorldSnapshot>()
  .store(simulationStore)
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

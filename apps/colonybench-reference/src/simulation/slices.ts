import type { SliceStoreAdapter } from '@specter-ts/core'

import { createAdvanceTick } from './advance-tick/impl'
import { createBuildConstructionSite } from './build-construction-site/impl'
import { createDepositEnergy } from './deposit-energy/impl'
import { createHarvestEnergy } from './harvest-energy/impl'
import { createInitializeSimulation } from './initialize-simulation/impl'
import { createLiveSimulationStatus } from './live-simulation-status/impl'
import { createLiveWorldSnapshot } from './live-world-snapshot/impl'
import { createMoveWorker } from './move-worker/impl'
import { createRepairRoad } from './repair-road/impl'
import { createSpawnWorker } from './spawn-worker/impl'
import type { ColonyBenchSimulationState } from './state'
import { createUpgradeBase } from './upgrade-base/impl'

export function createSimulationSlices(
  store: SliceStoreAdapter<ColonyBenchSimulationState>,
) {
  return [
    createInitializeSimulation(store),
    createMoveWorker(store),
    createHarvestEnergy(store),
    createDepositEnergy(store),
    createUpgradeBase(store),
    createSpawnWorker(store),
    createBuildConstructionSite(store),
    createRepairRoad(store),
    createAdvanceTick(store),
    createLiveSimulationStatus(store),
    createLiveWorldSnapshot(store),
  ] as const
}

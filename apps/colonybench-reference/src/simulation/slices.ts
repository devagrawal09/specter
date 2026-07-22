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
import { createUpgradeBase } from './upgrade-base/impl'

export const simulationSlices = [
  createInitializeSimulation,
  createMoveWorker,
  createHarvestEnergy,
  createDepositEnergy,
  createUpgradeBase,
  createSpawnWorker,
  createBuildConstructionSite,
  createRepairRoad,
  createAdvanceTick,
  createLiveSimulationStatus,
  createLiveWorldSnapshot,
] as const

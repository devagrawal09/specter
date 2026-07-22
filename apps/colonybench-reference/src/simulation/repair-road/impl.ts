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
import { isAdjacent, rejectCommand, repairRoadSchema } from '../shared'
import { REPAIR_AMOUNT, type ColonyBenchSimulationState } from '../state'
import specification from './spec.json' with { type: 'json' }
import { implementCommand } from '@specter-ts/core'

export function createRepairRoad(
  store: SliceStoreAdapter<ColonyBenchSimulationState>,
) {
  return implementCommand<'repairRoad'>(specification)
    .inputSchema(repairRoadSchema)
    .store(store)
    .apply(simulationInitializedEvent, applySimulationInitialized)
    .apply(workerMovedEvent, applyWorkerMoved)
    .apply(workerHarvestedEvent, applyWorkerHarvested)
    .apply(workerDepositedEvent, applyWorkerDeposited)
    .apply(baseUpgradedEvent, applyBaseUpgraded)
    .apply(workerSpawnedEvent, applyWorkerSpawned)
    .apply(constructionSiteBuiltEvent, applyConstructionSiteBuilt)
    .apply(roadCompletedEvent, applyRoadCompleted)
    .apply(tickAdvancedEvent, applyTickAdvanced)
    .apply(roadRepairedEvent, applyRoadRepaired)
    .apply(commandRejectedEvent, applyCommandRejected)
    .handle(async (command, state) => {
      const world = state.worlds[command.runId]
      if (!world)
        return rejectCommand(command.runId, 'repairRoad', 'world_missing')
      const worker = world.workers[command.workerId]
      if (!worker)
        return rejectCommand(command.runId, 'repairRoad', 'worker_missing')
      const road = world.roads[command.roadId]
      if (!road)
        return rejectCommand(command.runId, 'repairRoad', 'road_missing')
      if (!isAdjacent(worker.position, road.position)) {
        return rejectCommand(
          command.runId,
          'repairRoad',
          'worker_not_adjacent_to_road',
        )
      }
      if (worker.energy <= 0)
        return rejectCommand(command.runId, 'repairRoad', 'worker_empty')
      if (road.hits >= road.hitsMax)
        return rejectCommand(command.runId, 'repairRoad', 'road_full_hits')
      const amount = Math.min(
        REPAIR_AMOUNT,
        worker.energy,
        road.hitsMax - road.hits,
      )
      return [
        roadRepairedEvent.create({
          runId: command.runId,
          workerId: command.workerId,
          roadId: command.roadId,
          amount,
          hits: road.hits + amount,
        }),
      ]
    })
}

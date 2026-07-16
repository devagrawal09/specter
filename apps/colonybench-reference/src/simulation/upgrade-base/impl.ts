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
import { isAdjacent, rejectCommand, workerCommandSchema } from '../shared'
import type { ColonyBenchSimulationState } from '../state'
import { upgradeBaseSpec } from './spec'

export function createUpgradeBase(
  store: SliceStoreAdapter<ColonyBenchSimulationState>,
) {
  return upgradeBaseSpec
    .inputSchema(workerCommandSchema)
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
    .handle(async (command, state) => {
      const world = state.worlds[command.runId]
      if (!world)
        return rejectCommand(command.runId, 'upgradeBase', 'world_missing')
      const worker = world.workers[command.workerId]
      if (!worker)
        return rejectCommand(command.runId, 'upgradeBase', 'worker_missing')
      if (!isAdjacent(worker.position, world.controller.position)) {
        return rejectCommand(
          command.runId,
          'upgradeBase',
          'worker_not_adjacent_to_controller',
        )
      }
      if (worker.energy <= 0)
        return rejectCommand(command.runId, 'upgradeBase', 'worker_empty')
      const remaining =
        world.controller.progressTotal - world.controller.progress
      const amount = Math.min(worker.energy, remaining)
      const nextProgress = world.controller.progress + amount
      const didUpgrade = nextProgress >= world.controller.progressTotal
      return [
        baseUpgradedEvent.create({
          runId: command.runId,
          workerId: command.workerId,
          amount,
          level: didUpgrade ? world.base.level + 1 : world.base.level,
          upgradeProgress: didUpgrade ? 0 : nextProgress,
        }),
      ]
    })
}

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
import {
  isWallTerrain,
  moveWorkerSchema,
  rejectCommand,
  stepToward,
} from '../shared'
import { clonePosition, type ColonyBenchSimulationState } from '../state'
import specification from './spec.json' with { type: 'json' }
import { implementCommand } from '@specter-ts/core'

export function createMoveWorker(
  store: SliceStoreAdapter<ColonyBenchSimulationState>,
) {
  return implementCommand<'moveWorker'>(specification)
    .inputSchema(moveWorkerSchema)
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
        return rejectCommand(command.runId, 'moveWorker', 'world_missing')
      const worker = world.workers[command.workerId]
      if (!worker)
        return rejectCommand(command.runId, 'moveWorker', 'worker_missing')
      const from = clonePosition(worker.position)
      const to = stepToward(from, command.target)
      if (isWallTerrain(world.terrain, to)) {
        return rejectCommand(command.runId, 'moveWorker', 'terrain_wall')
      }
      return [
        workerMovedEvent.create({
          runId: command.runId,
          workerId: command.workerId,
          from,
          to,
          target: command.target,
        }),
      ]
    })
}

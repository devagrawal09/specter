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
import {
  isWallTerrain,
  moveWorkerSchema,
  rejectCommand,
  stepToward,
} from '../shared'
import { clonePosition } from '../state'
import { moveWorkerSpec } from './spec'

export const createMoveWorker = moveWorkerSpec
  .inputSchema(moveWorkerSchema)
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

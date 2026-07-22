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
import { isAdjacent, rejectCommand, workerCommandSchema } from '../shared'
import { depositEnergySpec } from './spec'

export const createDepositEnergy = depositEnergySpec
  .inputSchema(workerCommandSchema)
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
      return rejectCommand(command.runId, 'depositEnergy', 'world_missing')
    const worker = world.workers[command.workerId]
    if (!worker)
      return rejectCommand(command.runId, 'depositEnergy', 'worker_missing')
    if (!isAdjacent(worker.position, world.base.position)) {
      return rejectCommand(
        command.runId,
        'depositEnergy',
        'worker_not_adjacent_to_base',
      )
    }
    if (worker.energy <= 0)
      return rejectCommand(command.runId, 'depositEnergy', 'worker_empty')
    return [
      workerDepositedEvent.create({
        runId: command.runId,
        workerId: command.workerId,
        amount: worker.energy,
      }),
    ]
  })

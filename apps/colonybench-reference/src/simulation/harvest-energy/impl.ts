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
import { harvestEnergySchema, isAdjacent, rejectCommand } from '../shared'
import { HARVEST_AMOUNT } from '../state'
import { harvestEnergySpec } from './spec'

export const createHarvestEnergy = harvestEnergySpec
  .inputSchema(harvestEnergySchema)
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
      return rejectCommand(command.runId, 'harvestEnergy', 'world_missing')
    const worker = world.workers[command.workerId]
    if (!worker)
      return rejectCommand(command.runId, 'harvestEnergy', 'worker_missing')
    const source = world.sources[command.sourceId]
    if (!source)
      return rejectCommand(command.runId, 'harvestEnergy', 'source_missing')
    if (!isAdjacent(worker.position, source.position)) {
      return rejectCommand(
        command.runId,
        'harvestEnergy',
        'worker_not_adjacent_to_source',
      )
    }
    const availableCapacity = worker.capacity - worker.energy
    if (availableCapacity <= 0)
      return rejectCommand(command.runId, 'harvestEnergy', 'worker_full')
    if (source.energy <= 0)
      return rejectCommand(command.runId, 'harvestEnergy', 'source_empty')
    return [
      workerHarvestedEvent.create({
        runId: command.runId,
        workerId: command.workerId,
        sourceId: command.sourceId,
        amount: Math.min(HARVEST_AMOUNT, availableCapacity, source.energy),
      }),
    ]
  })

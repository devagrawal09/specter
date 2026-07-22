import type { SliceStoreAdapter } from '@specter-ts/core'
import { z } from 'zod'

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
import { rejectCommand, runIdSchema } from '../shared'
import {
  clonePosition,
  SPAWN_WORKER_COST,
  type ColonyBenchSimulationState,
} from '../state'
import specification from './spec.json' with { type: 'json' }
import { implementCommand } from '@specter-ts/core'

export function createSpawnWorker(
  store: SliceStoreAdapter<ColonyBenchSimulationState>,
) {
  return implementCommand<'spawnWorker'>(specification)
    .inputSchema(runIdSchema.extend({ workerId: z.string() }))
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
        return rejectCommand(command.runId, 'spawnWorker', 'world_missing')
      if (world.base.energy < SPAWN_WORKER_COST) {
        return rejectCommand(
          command.runId,
          'spawnWorker',
          'base_energy_too_low',
        )
      }
      if (world.workers[command.workerId]) {
        return rejectCommand(command.runId, 'spawnWorker', 'worker_exists')
      }
      return [
        workerSpawnedEvent.create({
          runId: command.runId,
          workerId: command.workerId,
          cost: SPAWN_WORKER_COST,
          position: clonePosition(world.base.position),
        }),
      ]
    })
}

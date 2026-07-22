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
import { rejectCommand, runIdSchema } from '../shared'
import {
  ROAD_DECAY_PER_TICK,
  SOURCE_MAX_ENERGY,
  SOURCE_REGEN_PER_TICK,
} from '../state'
import { advanceTickSpec } from './spec'

export const createAdvanceTick = advanceTickSpec
  .inputSchema(runIdSchema)
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
      return rejectCommand(command.runId, 'advanceTick', 'world_missing')
    const regeneratedSources = world.sourceOrder.flatMap((sourceId) => {
      const source = world.sources[sourceId]
      if (!source || source.energy >= SOURCE_MAX_ENERGY) return []
      const energy = Math.min(
        SOURCE_MAX_ENERGY,
        source.energy + SOURCE_REGEN_PER_TICK,
      )
      return [{ sourceId, amount: energy - source.energy, energy }]
    })
    const decayedRoads = world.roadOrder.flatMap((roadId) => {
      const road = world.roads[roadId]
      if (!road || road.hits <= 1) return []
      const hits = Math.max(1, road.hits - ROAD_DECAY_PER_TICK)
      return [{ roadId, amount: road.hits - hits, hits }]
    })
    return [
      tickAdvancedEvent.create({
        runId: command.runId,
        tick: world.tick + 1,
        regeneratedSources,
        decayedRoads,
      }),
    ]
  })

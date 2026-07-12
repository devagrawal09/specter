import {
  createCommandSlice,
  createQuerySlice,
  defineApplyHandlers,
  type Event,
  type EventDraft,
  type SliceStoreAdapter,
} from '@specter-ts/core'
import { z } from 'zod'

import {
  baseUpgradedEvent,
  commandRejectedEvent,
  constructionSiteBuiltEvent,
  positionSchema,
  simulationEventDefinitions,
  simulationInitializedEvent,
  roadCompletedEvent,
  roadRepairedEvent,
  tickAdvancedEvent,
  workerDepositedEvent,
  workerHarvestedEvent,
  workerMovedEvent,
  workerSpawnedEvent,
} from './events'
import {
  BUILD_AMOUNT,
  HARVEST_AMOUNT,
  REPAIR_AMOUNT,
  ROAD_DECAY_PER_TICK,
  ROAD_HITS_MAX,
  SPAWN_WORKER_COST,
  SOURCE_MAX_ENERGY,
  SOURCE_REGEN_PER_TICK,
  WORKER_CAPACITY,
  clonePosition,
  createInitialWorld,
  recomputeWorldScore,
  recordWorldEvent,
  snapshotWorld,
  type ColonyBenchConstructionSite,
  type ColonyBenchPosition,
  type ColonyBenchSimulationState,
} from './state'

type SimulationEvent = Event<string, unknown>

type SimulationCommand =
  | 'moveWorker'
  | 'harvestEnergy'
  | 'depositEnergy'
  | 'upgradeBase'
  | 'spawnWorker'
  | 'buildConstructionSite'
  | 'repairRoad'
  | 'advanceTick'

const simulationApplyHandlers = defineApplyHandlers(
  simulationEventDefinitions,
  {
    [simulationInitializedEvent.type]: async (event, state: ColonyBenchSimulationState) => {
      const payload = event.payload
      const world = createInitialWorld(payload.runId)
      recordWorldEvent(world, summarizeEvent(event))
      state.worlds[payload.runId] = world
    },
    [workerMovedEvent.type]: async (event, state: ColonyBenchSimulationState) => {
      const payload = event.payload
      const world = state.worlds[payload.runId]
      const worker = world?.workers[payload.workerId]
      if (!world || !worker) return

      worker.position = clonePosition(payload.to)
      recordWorldEvent(world, summarizeEvent(event))
    },
    [workerHarvestedEvent.type]: async (event, state: ColonyBenchSimulationState) => {
      const payload = event.payload
      const world = state.worlds[payload.runId]
      const worker = world?.workers[payload.workerId]
      const source = world?.sources[payload.sourceId]
      if (!world || !worker || !source) return

      worker.energy += payload.amount
      source.energy -= payload.amount
      recordWorldEvent(world, summarizeEvent(event))
    },
    [workerDepositedEvent.type]: async (event, state: ColonyBenchSimulationState) => {
      const payload = event.payload
      const world = state.worlds[payload.runId]
      const worker = world?.workers[payload.workerId]
      if (!world || !worker) return

      worker.energy -= payload.amount
      world.base.energy += payload.amount
      recordWorldEvent(world, summarizeEvent(event))
    },
    [baseUpgradedEvent.type]: async (event, state: ColonyBenchSimulationState) => {
      const payload = event.payload
      const world = state.worlds[payload.runId]
      const worker = world?.workers[payload.workerId]
      if (!world || !worker) return

      worker.energy -= payload.amount
      world.base.level = payload.level
      world.base.upgradeProgress = payload.upgradeProgress
      world.controller.level = payload.level
      world.controller.progress = payload.upgradeProgress
      recomputeWorldScore(world)
      recordWorldEvent(world, summarizeEvent(event))
    },
    [workerSpawnedEvent.type]: async (event, state: ColonyBenchSimulationState) => {
      const payload = event.payload
      const world = state.worlds[payload.runId]
      if (!world) return

      world.base.energy -= payload.cost
      world.workers[payload.workerId] = {
        id: payload.workerId,
        position: clonePosition(payload.position),
        energy: 0,
        capacity: WORKER_CAPACITY,
      }
      world.workerOrder.push(payload.workerId)
      recordWorldEvent(world, summarizeEvent(event))
    },
    [constructionSiteBuiltEvent.type]: async (event, state: ColonyBenchSimulationState) => {
      const payload = event.payload
      const world = state.worlds[payload.runId]
      const worker = world?.workers[payload.workerId]
      const site = world?.constructionSites[payload.siteId]
      if (!world || !worker || !site) return

      worker.energy -= payload.amount
      site.progress = payload.progress
      recordWorldEvent(world, summarizeEvent(event))
    },
    [roadCompletedEvent.type]: async (event, state: ColonyBenchSimulationState) => {
      const payload = event.payload
      const world = state.worlds[payload.runId]
      if (!world) return

      delete world.constructionSites[payload.siteId]
      world.constructionSiteOrder = world.constructionSiteOrder.filter(
        (siteId) => siteId !== payload.siteId,
      )
      world.roads[payload.roadId] = {
        id: payload.roadId,
        position: clonePosition(payload.position),
        hits: ROAD_HITS_MAX,
        hitsMax: ROAD_HITS_MAX,
      }
      world.roadOrder.push(payload.roadId)
      recordWorldEvent(world, summarizeEvent(event))
    },
    [roadRepairedEvent.type]: async (event, state: ColonyBenchSimulationState) => {
      const payload = event.payload
      const world = state.worlds[payload.runId]
      const worker = world?.workers[payload.workerId]
      const road = world?.roads[payload.roadId]
      if (!world || !worker || !road) return

      worker.energy -= payload.amount
      road.hits = payload.hits
      recordWorldEvent(world, summarizeEvent(event))
    },
    [commandRejectedEvent.type]: async (event, state: ColonyBenchSimulationState) => {
      const payload = event.payload
      recordWorldEvent(state.worlds[payload.runId], summarizeEvent(event))
    },
    [tickAdvancedEvent.type]: async (event, state: ColonyBenchSimulationState) => {
      const payload = event.payload
      const world = state.worlds[payload.runId]
      if (!world) return

      world.tick = payload.tick
      for (const regeneratedSource of payload.regeneratedSources) {
        const source = world.sources[regeneratedSource.sourceId]
        if (source) source.energy = regeneratedSource.energy
      }
      for (const decayedRoad of payload.decayedRoads) {
        const road = world.roads[decayedRoad.roadId]
        if (road) road.hits = decayedRoad.hits
      }
      recordWorldEvent(world, summarizeEvent(event))
    },
  },
)

const runIdSchema = z.object({
  runId: z.string(),
})

const workerCommandSchema = runIdSchema.extend({
  workerId: z.string(),
})

const moveWorkerSchema = workerCommandSchema.extend({
  target: positionSchema,
})

const harvestEnergySchema = workerCommandSchema.extend({
  sourceId: z.string(),
})

const buildConstructionSiteSchema = workerCommandSchema.extend({
  siteId: z.string(),
})

const repairRoadSchema = workerCommandSchema.extend({
  roadId: z.string(),
})

function summarizeEvent(event: SimulationEvent) {
  return {
    type: event.type,
    payload: event.payload,
  }
}

function rejectCommand(
  runId: string,
  command: SimulationCommand,
  reason: string,
): EventDraft[] {
  return [commandRejectedEvent.create({ runId, command, reason })]
}

function stepToward(
  from: ColonyBenchPosition,
  target: ColonyBenchPosition,
): ColonyBenchPosition {
  return {
    x: from.x + Math.sign(target.x - from.x),
    y: from.y + Math.sign(target.y - from.y),
  }
}


function roadIdForSite(site: ColonyBenchConstructionSite, existingRoadCount: number) {
  const suffix = site.id.match(/(\d+)$/)?.[1]
  return suffix ? `road-${suffix}` : `road-${existingRoadCount + 1}`
}

function isAdjacent(
  a: ColonyBenchPosition,
  b: ColonyBenchPosition,
) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) <= 1
}

function positionKey(position: ColonyBenchPosition) {
  return `${position.x},${position.y}`
}

function isWallTerrain(
  terrain: ColonyBenchSimulationState['worlds'][string]['terrain'],
  position: ColonyBenchPosition,
) {
  return Object.values(terrain).some(
    (tile) => tile.terrain === 'wall' && positionKey(tile.position) === positionKey(position),
  )
}

export function createSimulationSlices(
  store: SliceStoreAdapter<ColonyBenchSimulationState>,
) {
  const initializeSimulation = createCommandSlice(
    'initializeSimulation',
    'Initializes an in-memory ColonyBench simulation world.',
  )
    .schema(runIdSchema)
    .store(store)
    .handle(async (command) => [simulationInitializedEvent.create(command)])

  const moveWorker = createCommandSlice(
    'moveWorker',
    'Moves a worker one deterministic step toward a target position.',
  )
    .schema(moveWorkerSchema)
    .store(store)
    .apply(simulationApplyHandlers)
    .handle(async (command, state) => {
      const world = state.worlds[command.runId]
      if (!world) return rejectCommand(command.runId, 'moveWorker', 'world_missing')

      const worker = world.workers[command.workerId]
      if (!worker) return rejectCommand(command.runId, 'moveWorker', 'worker_missing')

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

  const harvestEnergy = createCommandSlice(
    'harvestEnergy',
    'Harvests energy from an adjacent source into a worker.',
  )
    .schema(harvestEnergySchema)
    .store(store)
    .apply(simulationApplyHandlers)
    .handle(async (command, state) => {
      const world = state.worlds[command.runId]
      if (!world) return rejectCommand(command.runId, 'harvestEnergy', 'world_missing')

      const worker = world.workers[command.workerId]
      if (!worker) return rejectCommand(command.runId, 'harvestEnergy', 'worker_missing')

      const source = world.sources[command.sourceId]
      if (!source) return rejectCommand(command.runId, 'harvestEnergy', 'source_missing')

      if (!isAdjacent(worker.position, source.position)) {
        return rejectCommand(
          command.runId,
          'harvestEnergy',
          'worker_not_adjacent_to_source',
        )
      }

      const availableCapacity = worker.capacity - worker.energy
      if (availableCapacity <= 0) {
        return rejectCommand(command.runId, 'harvestEnergy', 'worker_full')
      }
      if (source.energy <= 0) {
        return rejectCommand(command.runId, 'harvestEnergy', 'source_empty')
      }

      const amount = Math.min(HARVEST_AMOUNT, availableCapacity, source.energy)
      return [
        workerHarvestedEvent.create({
          runId: command.runId,
          workerId: command.workerId,
          sourceId: command.sourceId,
          amount,
        }),
      ]
    })

  const depositEnergy = createCommandSlice(
    'depositEnergy',
    'Deposits a worker carried energy into an adjacent base.',
  )
    .schema(workerCommandSchema)
    .store(store)
    .apply(simulationApplyHandlers)
    .handle(async (command, state) => {
      const world = state.worlds[command.runId]
      if (!world) return rejectCommand(command.runId, 'depositEnergy', 'world_missing')

      const worker = world.workers[command.workerId]
      if (!worker) return rejectCommand(command.runId, 'depositEnergy', 'worker_missing')

      if (!isAdjacent(worker.position, world.base.position)) {
        return rejectCommand(
          command.runId,
          'depositEnergy',
          'worker_not_adjacent_to_base',
        )
      }
      if (worker.energy <= 0) {
        return rejectCommand(command.runId, 'depositEnergy', 'worker_empty')
      }

      return [
        workerDepositedEvent.create({
          runId: command.runId,
          workerId: command.workerId,
          amount: worker.energy,
        }),
      ]
    })

  const upgradeBase = createCommandSlice(
    'upgradeBase',
    'Consumes adjacent worker energy as base upgrade progress.',
  )
    .schema(workerCommandSchema)
    .store(store)
    .apply(simulationApplyHandlers)
    .handle(async (command, state) => {
      const world = state.worlds[command.runId]
      if (!world) return rejectCommand(command.runId, 'upgradeBase', 'world_missing')

      const worker = world.workers[command.workerId]
      if (!worker) return rejectCommand(command.runId, 'upgradeBase', 'worker_missing')

      if (!isAdjacent(worker.position, world.controller.position)) {
        return rejectCommand(
          command.runId,
          'upgradeBase',
          'worker_not_adjacent_to_controller',
        )
      }
      if (worker.energy <= 0) {
        return rejectCommand(command.runId, 'upgradeBase', 'worker_empty')
      }

      const remainingProgress = world.controller.progressTotal - world.controller.progress
      const amount = Math.min(worker.energy, remainingProgress)
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

  const spawnWorker = createCommandSlice(
    'spawnWorker',
    'Spawns a deterministic worker at the base by spending base energy.',
  )
    .schema(runIdSchema)
    .store(store)
    .apply(simulationApplyHandlers)
    .handle(async (command, state) => {
      const world = state.worlds[command.runId]
      if (!world) return rejectCommand(command.runId, 'spawnWorker', 'world_missing')

      if (world.base.energy < SPAWN_WORKER_COST) {
        return rejectCommand(command.runId, 'spawnWorker', 'base_energy_too_low')
      }

      const workerId = `worker-${world.workerOrder.length + 1}`
      return [
        workerSpawnedEvent.create({
          runId: command.runId,
          workerId,
          cost: SPAWN_WORKER_COST,
          position: clonePosition(world.base.position),
        }),
      ]
    })


  const buildConstructionSite = createCommandSlice(
    'buildConstructionSite',
    'Builds an adjacent construction site with carried worker energy.',
  )
    .schema(buildConstructionSiteSchema)
    .store(store)
    .apply(simulationApplyHandlers)
    .handle(async (command, state) => {
      const world = state.worlds[command.runId]
      if (!world) return rejectCommand(command.runId, 'buildConstructionSite', 'world_missing')

      const worker = world.workers[command.workerId]
      if (!worker) return rejectCommand(command.runId, 'buildConstructionSite', 'worker_missing')

      const site = world.constructionSites[command.siteId]
      if (!site) return rejectCommand(command.runId, 'buildConstructionSite', 'site_missing')

      if (!isAdjacent(worker.position, site.position)) {
        return rejectCommand(
          command.runId,
          'buildConstructionSite',
          'worker_not_adjacent_to_site',
        )
      }
      if (worker.energy <= 0) {
        return rejectCommand(command.runId, 'buildConstructionSite', 'worker_empty')
      }

      const remainingProgress = site.progressTotal - site.progress
      const amount = Math.min(BUILD_AMOUNT, worker.energy, remainingProgress)
      const progress = site.progress + amount
      const completed = progress >= site.progressTotal
      const events: EventDraft[] = [
        constructionSiteBuiltEvent.create({
          runId: command.runId,
          workerId: command.workerId,
          siteId: command.siteId,
          amount,
          progress,
          completed,
        }),
      ]

      if (completed) {
        events.push(
          roadCompletedEvent.create({
            runId: command.runId,
            siteId: command.siteId,
            roadId: roadIdForSite(site, world.roadOrder.length),
            position: clonePosition(site.position),
          }),
        )
      }

      return events
    })


  const repairRoad = createCommandSlice(
    'repairRoad',
    'Repairs an adjacent damaged road with carried worker energy.',
  )
    .schema(repairRoadSchema)
    .store(store)
    .apply(simulationApplyHandlers)
    .handle(async (command, state) => {
      const world = state.worlds[command.runId]
      if (!world) return rejectCommand(command.runId, 'repairRoad', 'world_missing')

      const worker = world.workers[command.workerId]
      if (!worker) return rejectCommand(command.runId, 'repairRoad', 'worker_missing')

      const road = world.roads[command.roadId]
      if (!road) return rejectCommand(command.runId, 'repairRoad', 'road_missing')

      if (!isAdjacent(worker.position, road.position)) {
        return rejectCommand(
          command.runId,
          'repairRoad',
          'worker_not_adjacent_to_road',
        )
      }
      if (worker.energy <= 0) {
        return rejectCommand(command.runId, 'repairRoad', 'worker_empty')
      }
      if (road.hits >= road.hitsMax) {
        return rejectCommand(command.runId, 'repairRoad', 'road_full_hits')
      }

      const amount = Math.min(REPAIR_AMOUNT, worker.energy, road.hitsMax - road.hits)
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

  const advanceTick = createCommandSlice(
    'advanceTick',
    'Advances a simulation world tick counter.',
  )
    .schema(runIdSchema)
    .store(store)
    .apply(simulationApplyHandlers)
    .handle(async (command, state) => {
      const world = state.worlds[command.runId]
      if (!world) return rejectCommand(command.runId, 'advanceTick', 'world_missing')

      const regeneratedSources = world.sourceOrder
        .map((sourceId) => {
          const source = world.sources[sourceId]
          if (!source || source.energy >= SOURCE_MAX_ENERGY) return null

          const energy = Math.min(SOURCE_MAX_ENERGY, source.energy + SOURCE_REGEN_PER_TICK)
          return {
            sourceId,
            amount: energy - source.energy,
            energy,
          }
        })
        .filter((source): source is { sourceId: string; amount: number; energy: number } =>
          Boolean(source),
        )

      const decayedRoads = world.roadOrder
        .map((roadId) => {
          const road = world.roads[roadId]
          if (!road || road.hits <= 1) return null

          const hits = Math.max(1, road.hits - ROAD_DECAY_PER_TICK)
          return {
            roadId,
            amount: road.hits - hits,
            hits,
          }
        })
        .filter((road): road is { roadId: string; amount: number; hits: number } =>
          Boolean(road),
        )

      return [
        tickAdvancedEvent.create({
          runId: command.runId,
          tick: world.tick + 1,
          regeneratedSources,
          decayedRoads,
        }),
      ]
    })

  const liveSimulationStatus = createQuerySlice(
    'liveSimulationStatus',
    'Returns the live in-memory simulation status for a run.',
  )
    .schema(runIdSchema)
    .store(store)
    .apply(simulationApplyHandlers)
    .handle(async (query, state) => ({
      runId: query.runId,
      initialized: Boolean(state.worlds[query.runId]),
      status: state.worlds[query.runId]
        ? ('initialized' as const)
        : ('missing' as const),
    }))

  const liveWorldSnapshot = createQuerySlice(
    'liveWorldSnapshot',
    'Returns the live ColonyBench world state and recent granular events.',
  )
    .schema(runIdSchema)
    .store(store)
    .apply(simulationApplyHandlers)
    .handle(async (query, state) => snapshotWorld(query.runId, state.worlds[query.runId]))

  return [
    initializeSimulation,
    moveWorker,
    harvestEnergy,
    depositEnergy,
    upgradeBase,
    spawnWorker,
    buildConstructionSite,
    repairRoad,
    advanceTick,
    liveSimulationStatus,
    liveWorldSnapshot,
  ] as const
}

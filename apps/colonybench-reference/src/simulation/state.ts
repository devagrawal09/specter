export const WORKER_CAPACITY = 10
export const HARVEST_AMOUNT = 5
export const SPAWN_WORKER_COST = 10
export const BASE_UPGRADE_ENERGY_REQUIRED = 10
export const SOURCE_MAX_ENERGY = 100
export const SOURCE_REGEN_PER_TICK = 2
export const BUILD_AMOUNT = 5
export const REPAIR_AMOUNT = 5
export const ROAD_HITS_MAX = 20
export const ROAD_DECAY_PER_TICK = 1
export const CONSTRUCTION_SITE_PROGRESS_TOTAL = 10
export const RECENT_EVENT_LIMIT = 20

export type ColonyBenchPosition = {
  x: number
  y: number
}

export type ColonyBenchBase = {
  id: string
  position: ColonyBenchPosition
  energy: number
  level: number
  upgradeProgress: number
}

export type ColonyBenchController = {
  id: string
  position: ColonyBenchPosition
  level: number
  progress: number
  progressTotal: number
}

export type ColonyBenchWorker = {
  id: string
  position: ColonyBenchPosition
  energy: number
  capacity: number
}

export type ColonyBenchSource = {
  id: string
  position: ColonyBenchPosition
  energy: number
}

export type ColonyBenchConstructionSite = {
  id: string
  structureType: 'road'
  position: ColonyBenchPosition
  progress: number
  progressTotal: number
}

export type ColonyBenchRoad = {
  id: string
  position: ColonyBenchPosition
  hits: number
  hitsMax: number
}

export type ColonyBenchTerrainTile = {
  id: string
  position: ColonyBenchPosition
  terrain: 'wall'
}

export type ColonyBenchWorldEventSummary = {
  type: string
  payload: unknown
}

export type ColonyBenchWorld = {
  runId: string
  initialized: true
  tick: number
  score: number
  base: ColonyBenchBase
  controller: ColonyBenchController
  workers: Record<string, ColonyBenchWorker>
  workerOrder: string[]
  sources: Record<string, ColonyBenchSource>
  sourceOrder: string[]
  constructionSites: Record<string, ColonyBenchConstructionSite>
  constructionSiteOrder: string[]
  roads: Record<string, ColonyBenchRoad>
  roadOrder: string[]
  terrain: Record<string, ColonyBenchTerrainTile>
  terrainOrder: string[]
  recentEvents: ColonyBenchWorldEventSummary[]
}

export type ColonyBenchWorldSnapshot = {
  runId: string
  initialized: boolean
  tick: number
  score: number
  base: ColonyBenchBase | null
  controller: ColonyBenchController | null
  workers: ColonyBenchWorker[]
  sources: ColonyBenchSource[]
  constructionSites: ColonyBenchConstructionSite[]
  roads: ColonyBenchRoad[]
  terrain: ColonyBenchTerrainTile[]
  recentEvents: ColonyBenchWorldEventSummary[]
}

export type ColonyBenchSimulationStatus = {
  runId: string
  initialized: boolean
  status: 'missing' | 'initialized'
}

export type ColonyBenchSimulationState = {
  worlds: Record<string, ColonyBenchWorld>
}

export function createColonyBenchSimulationState(): ColonyBenchSimulationState {
  return { worlds: {} }
}

export function createInitialWorld(runId: string): ColonyBenchWorld {
  return {
    runId,
    initialized: true,
    tick: 0,
    score: 0,
    base: {
      id: 'base-1',
      position: { x: 0, y: 0 },
      energy: 0,
      level: 1,
      upgradeProgress: 0,
    },
    controller: {
      id: 'controller-1',
      position: { x: 0, y: -1 },
      level: 1,
      progress: 0,
      progressTotal: BASE_UPGRADE_ENERGY_REQUIRED,
    },
    workers: {
      'worker-1': {
        id: 'worker-1',
        position: { x: 0, y: 1 },
        energy: 0,
        capacity: WORKER_CAPACITY,
      },
    },
    workerOrder: ['worker-1'],
    sources: {
      'source-1': {
        id: 'source-1',
        position: { x: 2, y: 1 },
        energy: 100,
      },
      'source-2': {
        id: 'source-2',
        position: { x: -2, y: 0 },
        energy: 100,
      },
    },
    sourceOrder: ['source-1', 'source-2'],
    constructionSites: {
      'road-site-1': {
        id: 'road-site-1',
        structureType: 'road',
        position: { x: 1, y: 0 },
        progress: 0,
        progressTotal: CONSTRUCTION_SITE_PROGRESS_TOTAL,
      },
    },
    constructionSiteOrder: ['road-site-1'],
    roads: {},
    roadOrder: [],
    terrain: {
      'wall-1': {
        id: 'wall-1',
        position: { x: -1, y: 1 },
        terrain: 'wall',
      },
    },
    terrainOrder: ['wall-1'],
    recentEvents: [],
  }
}

export function recordWorldEvent(
  world: ColonyBenchWorld | undefined,
  event: ColonyBenchWorldEventSummary,
) {
  if (!world) return

  world.recentEvents = [...world.recentEvents, event].slice(-RECENT_EVENT_LIMIT)
}

export function recomputeWorldScore(world: ColonyBenchWorld) {
  world.score = (world.base.level - 1) * 100
}

export function clonePosition(position: ColonyBenchPosition): ColonyBenchPosition {
  return { x: position.x, y: position.y }
}

export function cloneWorker(worker: ColonyBenchWorker): ColonyBenchWorker {
  return {
    id: worker.id,
    position: clonePosition(worker.position),
    energy: worker.energy,
    capacity: worker.capacity,
  }
}

export function cloneBase(base: ColonyBenchBase): ColonyBenchBase {
  return {
    id: base.id,
    position: clonePosition(base.position),
    energy: base.energy,
    level: base.level,
    upgradeProgress: base.upgradeProgress,
  }
}

export function cloneController(
  controller: ColonyBenchController,
): ColonyBenchController {
  return {
    id: controller.id,
    position: clonePosition(controller.position),
    level: controller.level,
    progress: controller.progress,
    progressTotal: controller.progressTotal,
  }
}

export function cloneSource(source: ColonyBenchSource): ColonyBenchSource {
  return {
    id: source.id,
    position: clonePosition(source.position),
    energy: source.energy,
  }
}

export function cloneConstructionSite(
  site: ColonyBenchConstructionSite,
): ColonyBenchConstructionSite {
  return {
    id: site.id,
    structureType: site.structureType,
    position: clonePosition(site.position),
    progress: site.progress,
    progressTotal: site.progressTotal,
  }
}

export function cloneRoad(road: ColonyBenchRoad): ColonyBenchRoad {
  return {
    id: road.id,
    position: clonePosition(road.position),
    hits: road.hits,
    hitsMax: road.hitsMax,
  }
}

export function cloneTerrainTile(tile: ColonyBenchTerrainTile): ColonyBenchTerrainTile {
  return {
    id: tile.id,
    position: clonePosition(tile.position),
    terrain: tile.terrain,
  }
}

export function snapshotWorld(
  runId: string,
  world: ColonyBenchWorld | undefined,
): ColonyBenchWorldSnapshot {
  if (!world) {
    return {
      runId,
      initialized: false,
      tick: 0,
      score: 0,
      base: null,
      controller: null,
      workers: [],
      sources: [],
      constructionSites: [],
      roads: [],
      terrain: [],
      recentEvents: [],
    }
  }

  return {
    runId: world.runId,
    initialized: true,
    tick: world.tick,
    score: world.score,
    base: cloneBase(world.base),
    controller: cloneController(world.controller),
    workers: world.workerOrder.map((workerId) => cloneWorker(world.workers[workerId])),
    sources: world.sourceOrder.map((sourceId) => cloneSource(world.sources[sourceId])),
    constructionSites: world.constructionSiteOrder.map((siteId) =>
      cloneConstructionSite(world.constructionSites[siteId]),
    ),
    roads: world.roadOrder.map((roadId) => cloneRoad(world.roads[roadId])),
    terrain: world.terrainOrder.map((tileId) => cloneTerrainTile(world.terrain[tileId])),
    recentEvents: world.recentEvents.map((event) => ({
      type: event.type,
      payload: event.payload,
    })),
  }
}

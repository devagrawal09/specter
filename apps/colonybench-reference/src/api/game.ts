import { SPAWN_WORKER_COST, type ColonyBenchBase, type ColonyBenchController, type ColonyBenchConstructionSite, type ColonyBenchPosition, type ColonyBenchRoad, type ColonyBenchSource, type ColonyBenchWorker, type ColonyBenchWorldSnapshot } from '../simulation/state'
import type { ColonyBenchBotCommands } from '../runner/types'

export const OK = 0
export const ERR_NOT_ENOUGH_ENERGY = -6
export const ERR_NOT_ENOUGH_RESOURCES = -6
export const ERR_INVALID_TARGET = -7
export const ERR_NOT_IN_RANGE = -9

export const FIND_SOURCES = 105
export const FIND_CONSTRUCTION_SITES = 107
export const FIND_STRUCTURES = 109
export const RESOURCE_ENERGY = 'energy'
export const STRUCTURE_ROAD = 'road'

export type ColonyBenchApiReturnCode =
  | typeof OK
  | typeof ERR_NOT_ENOUGH_ENERGY
  | typeof ERR_INVALID_TARGET
  | typeof ERR_NOT_IN_RANGE

type ReturnCode = ColonyBenchApiReturnCode

export type ColonyBenchApiIntentAction =
  | 'spawnCreep'
  | 'moveTo'
  | 'harvest'
  | 'transfer'
  | 'upgradeController'
  | 'build'
  | 'repair'
  | 'say'

export type ColonyBenchApiIntentLogEntry = {
  actorId: string
  action: ColonyBenchApiIntentAction
  targetId?: string
  target?: ColonyBenchApiPosition
  message?: string
  code: ColonyBenchApiReturnCode
}

type ColonyBenchApiValidTargetIds = {
  sourceIds: Set<string>
  spawnIds: Set<string>
  constructionSiteIds: Set<string>
  roadIds: Set<string>
  controllerIds: Set<string>
}

type CreepMemoryRecord = Record<string, Record<string, unknown>>

export type ColonyBenchApiMemory = Record<string, unknown> & {
  creeps?: CreepMemoryRecord
}

export type ColonyBenchApiStore = {
  energy: number
  capacity?: number
}

export type ColonyBenchApiPosition = ColonyBenchPosition

export type ColonyBenchApiTerrain = 'plain' | 'wall'

export type ColonyBenchApiSource = {
  id: string
  pos: ColonyBenchApiPosition
  energy: number
}

export type ColonyBenchApiConstructionSite = {
  id: string
  structureType: ColonyBenchConstructionSite['structureType']
  pos: ColonyBenchApiPosition
  progress: number
  progressTotal: number
}

export type ColonyBenchApiRoad = {
  id: string
  structureType: typeof STRUCTURE_ROAD
  pos: ColonyBenchApiPosition
  hits: number
  hitsMax: number
}

export type ColonyBenchApiController = {
  id: string
  pos: ColonyBenchApiPosition
  level: number
  progress: number
  progressTotal: number
}

export type ColonyBenchApiSpawn = {
  id: string
  name: string
  pos: ColonyBenchApiPosition
  store: ColonyBenchApiStore
  spawnCreep: (body: string[], name: string) => ReturnCode
}

export type ColonyBenchApiCreep = {
  id: string
  name: string
  pos: ColonyBenchApiPosition
  store: Required<ColonyBenchApiStore>
  memory: Record<string, unknown>
  moveTo: (target: ColonyBenchApiPosition | { pos: ColonyBenchApiPosition }) => ReturnCode
  harvest: (source: ColonyBenchApiSource) => ReturnCode
  transfer: (target: ColonyBenchApiSpawn, resourceType: typeof RESOURCE_ENERGY) => ReturnCode
  upgradeController: (controller?: ColonyBenchApiController) => ReturnCode
  build: (site: ColonyBenchApiConstructionSite) => ReturnCode
  repair: (road: ColonyBenchApiRoad) => ReturnCode
  say: (message: string) => typeof OK
}

export type ColonyBenchApiLookAtResult =
  | { type: 'terrain'; terrain: ColonyBenchApiTerrain }
  | { type: 'source'; source: ColonyBenchApiSource }
  | { type: 'structure'; structure: ColonyBenchApiSpawn | ColonyBenchApiController | ColonyBenchApiRoad }
  | { type: 'constructionSite'; constructionSite: ColonyBenchApiConstructionSite }
  | { type: 'creep'; creep: ColonyBenchApiCreep }

export type ColonyBenchApiRoom = {
  name: 'sim'
  sources: ColonyBenchApiSource[]
  constructionSites: ColonyBenchApiConstructionSite[]
  roads: ColonyBenchApiRoad[]
  controller: ColonyBenchApiController
  getTerrainAt: (x: number, y: number) => ColonyBenchApiTerrain
  lookAt: (x: number, y: number) => ColonyBenchApiLookAtResult[]
  find: (
    findConstant: typeof FIND_SOURCES | typeof FIND_CONSTRUCTION_SITES | typeof FIND_STRUCTURES,
  ) => Array<ColonyBenchApiSource | ColonyBenchApiConstructionSite | ColonyBenchApiRoad>
}

export type ColonyBenchGame = {
  time: number
  Memory: ColonyBenchApiMemory
  creeps: Record<string, ColonyBenchApiCreep>
  spawns: Record<string, ColonyBenchApiSpawn>
  rooms: { sim: ColonyBenchApiRoom }
}

export type CreateColonyBenchGameOptions = {
  snapshot: ColonyBenchWorldSnapshot
  commands: ColonyBenchBotCommands
  memory: ColonyBenchApiMemory
  apiIntents?: ColonyBenchApiIntentLogEntry[]
}

function clonePosition(position: ColonyBenchPosition): ColonyBenchApiPosition {
  return { x: position.x, y: position.y }
}

function distance(left: ColonyBenchPosition, right: ColonyBenchPosition) {
  return Math.abs(left.x - right.x) + Math.abs(left.y - right.y)
}

function isAdjacent(left: ColonyBenchPosition, right: ColonyBenchPosition) {
  return distance(left, right) <= 1
}

function targetPosition(target: ColonyBenchApiPosition | { pos: ColonyBenchApiPosition }) {
  return 'pos' in target ? target.pos : target
}

function ensureCreepMemory(memory: ColonyBenchApiMemory, workerId: string) {
  const creeps = (memory.creeps ??= {})
  return (creeps[workerId] ??= {})
}

function recordApiIntent(
  apiIntents: ColonyBenchApiIntentLogEntry[] | undefined,
  entry: ColonyBenchApiIntentLogEntry,
) {
  apiIntents?.push({
    ...entry,
    target: entry.target ? clonePosition(entry.target) : undefined,
  })
}

function recordAndReturn(
  apiIntents: ColonyBenchApiIntentLogEntry[] | undefined,
  entry: ColonyBenchApiIntentLogEntry,
) {
  recordApiIntent(apiIntents, entry)
  return entry.code
}

function createSource(source: ColonyBenchSource): ColonyBenchApiSource {
  return {
    id: source.id,
    pos: clonePosition(source.position),
    energy: source.energy,
  }
}

function createConstructionSite(
  site: ColonyBenchConstructionSite,
): ColonyBenchApiConstructionSite {
  return {
    id: site.id,
    structureType: site.structureType,
    pos: clonePosition(site.position),
    progress: site.progress,
    progressTotal: site.progressTotal,
  }
}

function createRoad(road: ColonyBenchRoad): ColonyBenchApiRoad {
  return {
    id: road.id,
    structureType: STRUCTURE_ROAD,
    pos: clonePosition(road.position),
    hits: road.hits,
    hitsMax: road.hitsMax,
  }
}

function createController(controller: ColonyBenchController | null, base: ColonyBenchBase | null): ColonyBenchApiController {
  return {
    id: controller?.id ?? 'controller-1',
    pos: clonePosition(controller?.position ?? base?.position ?? { x: 0, y: 0 }),
    level: controller?.level ?? base?.level ?? 0,
    progress: controller?.progress ?? base?.upgradeProgress ?? 0,
    progressTotal: controller?.progressTotal ?? 10,
  }
}

function createSpawn({
  base,
  commands,
  apiIntents,
}: {
  base: ColonyBenchBase
  commands: ColonyBenchBotCommands
  apiIntents?: ColonyBenchApiIntentLogEntry[]
}): ColonyBenchApiSpawn {
  return {
    id: base.id,
    name: base.id,
    pos: clonePosition(base.position),
    store: { energy: base.energy },
    spawnCreep(_body, name) {
      if (base.energy < SPAWN_WORKER_COST) {
        return recordAndReturn(apiIntents, {
          actorId: base.id,
          action: 'spawnCreep',
          targetId: name,
          code: ERR_NOT_ENOUGH_ENERGY,
        })
      }

      commands.spawnWorker()
      return recordAndReturn(apiIntents, {
        actorId: base.id,
        action: 'spawnCreep',
        targetId: name,
        code: OK,
      })
    },
  }
}

function createCreep({
  worker,
  controller,
  commands,
  memory,
  apiIntents,
  validTargetIds,
}: {
  worker: ColonyBenchWorker
  controller: ColonyBenchApiController
  commands: ColonyBenchBotCommands
  memory: ColonyBenchApiMemory
  apiIntents?: ColonyBenchApiIntentLogEntry[]
  validTargetIds: ColonyBenchApiValidTargetIds
}): ColonyBenchApiCreep {
  return {
    id: worker.id,
    name: worker.id,
    pos: clonePosition(worker.position),
    store: { energy: worker.energy, capacity: worker.capacity },
    get memory() {
      return ensureCreepMemory(memory, worker.id)
    },
    say(message) {
      ensureCreepMemory(memory, worker.id).saying = message
      recordApiIntent(apiIntents, {
        actorId: worker.id,
        action: 'say',
        message,
        code: OK,
      })
      return OK
    },
    moveTo(target) {
      const destination = clonePosition(targetPosition(target))
      commands.move(worker.id, destination)
      return recordAndReturn(apiIntents, {
        actorId: worker.id,
        action: 'moveTo',
        target: destination,
        code: OK,
      })
    },
    harvest(source) {
      if (!validTargetIds.sourceIds.has(source.id)) {
        return recordAndReturn(apiIntents, {
          actorId: worker.id,
          action: 'harvest',
          targetId: source.id,
          code: ERR_INVALID_TARGET,
        })
      }
      if (!isAdjacent(worker.position, source.pos)) {
        return recordAndReturn(apiIntents, {
          actorId: worker.id,
          action: 'harvest',
          targetId: source.id,
          code: ERR_NOT_IN_RANGE,
        })
      }
      if (worker.energy >= worker.capacity || source.energy <= 0) {
        return recordAndReturn(apiIntents, {
          actorId: worker.id,
          action: 'harvest',
          targetId: source.id,
          code: ERR_NOT_ENOUGH_RESOURCES,
        })
      }

      commands.harvest(worker.id, source.id)
      return recordAndReturn(apiIntents, {
        actorId: worker.id,
        action: 'harvest',
        targetId: source.id,
        code: OK,
      })
    },
    transfer(target, resourceType) {
      if (!validTargetIds.spawnIds.has(target.id)) {
        return recordAndReturn(apiIntents, {
          actorId: worker.id,
          action: 'transfer',
          targetId: target.id,
          code: ERR_INVALID_TARGET,
        })
      }
      if (resourceType !== RESOURCE_ENERGY) {
        return recordAndReturn(apiIntents, {
          actorId: worker.id,
          action: 'transfer',
          targetId: target.id,
          code: ERR_INVALID_TARGET,
        })
      }
      if (!isAdjacent(worker.position, target.pos)) {
        return recordAndReturn(apiIntents, {
          actorId: worker.id,
          action: 'transfer',
          targetId: target.id,
          code: ERR_NOT_IN_RANGE,
        })
      }
      if (worker.energy <= 0) {
        return recordAndReturn(apiIntents, {
          actorId: worker.id,
          action: 'transfer',
          targetId: target.id,
          code: ERR_NOT_ENOUGH_RESOURCES,
        })
      }

      commands.deposit(worker.id)
      return recordAndReturn(apiIntents, {
        actorId: worker.id,
        action: 'transfer',
        targetId: target.id,
        code: OK,
      })
    },
    upgradeController(target = controller) {
      if (!validTargetIds.controllerIds.has(target.id)) {
        return recordAndReturn(apiIntents, {
          actorId: worker.id,
          action: 'upgradeController',
          targetId: target.id,
          code: ERR_INVALID_TARGET,
        })
      }
      if (!isAdjacent(worker.position, target.pos)) {
        return recordAndReturn(apiIntents, {
          actorId: worker.id,
          action: 'upgradeController',
          targetId: target.id,
          code: ERR_NOT_IN_RANGE,
        })
      }
      if (worker.energy <= 0) {
        return recordAndReturn(apiIntents, {
          actorId: worker.id,
          action: 'upgradeController',
          targetId: target.id,
          code: ERR_NOT_ENOUGH_RESOURCES,
        })
      }

      commands.upgrade(worker.id)
      return recordAndReturn(apiIntents, {
        actorId: worker.id,
        action: 'upgradeController',
        targetId: target.id,
        code: OK,
      })
    },
    build(site) {
      if (!validTargetIds.constructionSiteIds.has(site.id)) {
        return recordAndReturn(apiIntents, {
          actorId: worker.id,
          action: 'build',
          targetId: site.id,
          code: ERR_INVALID_TARGET,
        })
      }
      if (!isAdjacent(worker.position, site.pos)) {
        return recordAndReturn(apiIntents, {
          actorId: worker.id,
          action: 'build',
          targetId: site.id,
          code: ERR_NOT_IN_RANGE,
        })
      }
      if (worker.energy <= 0) {
        return recordAndReturn(apiIntents, {
          actorId: worker.id,
          action: 'build',
          targetId: site.id,
          code: ERR_NOT_ENOUGH_RESOURCES,
        })
      }

      commands.build(worker.id, site.id)
      return recordAndReturn(apiIntents, {
        actorId: worker.id,
        action: 'build',
        targetId: site.id,
        code: OK,
      })
    },
    repair(road) {
      if (!validTargetIds.roadIds.has(road.id)) {
        return recordAndReturn(apiIntents, {
          actorId: worker.id,
          action: 'repair',
          targetId: road.id,
          code: ERR_INVALID_TARGET,
        })
      }
      if (!isAdjacent(worker.position, road.pos)) {
        return recordAndReturn(apiIntents, {
          actorId: worker.id,
          action: 'repair',
          targetId: road.id,
          code: ERR_NOT_IN_RANGE,
        })
      }
      if (worker.energy <= 0) {
        return recordAndReturn(apiIntents, {
          actorId: worker.id,
          action: 'repair',
          targetId: road.id,
          code: ERR_NOT_ENOUGH_RESOURCES,
        })
      }
      if (road.hits >= road.hitsMax) {
        return recordAndReturn(apiIntents, {
          actorId: worker.id,
          action: 'repair',
          targetId: road.id,
          code: ERR_INVALID_TARGET,
        })
      }

      commands.repair(worker.id, road.id)
      return recordAndReturn(apiIntents, {
        actorId: worker.id,
        action: 'repair',
        targetId: road.id,
        code: OK,
      })
    },
  }
}

function createRoom({
  sources,
  constructionSites,
  roads,
  controller,
  terrain,
  spawns,
  creeps,
}: {
  sources: ColonyBenchApiSource[]
  constructionSites: ColonyBenchApiConstructionSite[]
  roads: ColonyBenchApiRoad[]
  controller: ColonyBenchApiController
  terrain: NonNullable<ColonyBenchWorldSnapshot['terrain']>
  spawns: ColonyBenchApiSpawn[]
  creeps: ColonyBenchApiCreep[]
}): ColonyBenchApiRoom {
  const terrainByPosition = new Map(terrain.map((tile) => [`${tile.position.x},${tile.position.y}`, tile.terrain]))

  return {
    name: 'sim',
    sources,
    constructionSites,
    roads,
    controller,
    getTerrainAt(x, y) {
      return terrainByPosition.get(`${x},${y}`) ?? 'plain'
    },
    lookAt(x, y) {
      const position = { x, y }
      const results: ColonyBenchApiLookAtResult[] = []
      const terrainAtPosition = terrainByPosition.get(`${x},${y}`)
      if (terrainAtPosition) results.push({ type: 'terrain', terrain: terrainAtPosition })
      for (const source of sources) {
        if (source.pos.x === position.x && source.pos.y === position.y) results.push({ type: 'source', source })
      }
      if (controller.pos.x === position.x && controller.pos.y === position.y) {
        results.push({ type: 'structure', structure: controller })
      }
      for (const spawn of spawns) {
        if (spawn.pos.x === position.x && spawn.pos.y === position.y) results.push({ type: 'structure', structure: spawn })
      }
      for (const road of roads) {
        if (road.pos.x === position.x && road.pos.y === position.y) results.push({ type: 'structure', structure: road })
      }
      for (const site of constructionSites) {
        if (site.pos.x === position.x && site.pos.y === position.y) {
          results.push({ type: 'constructionSite', constructionSite: site })
        }
      }
      for (const creep of creeps) {
        if (creep.pos.x === position.x && creep.pos.y === position.y) results.push({ type: 'creep', creep })
      }
      return results
    },
    find(findConstant) {
      if (findConstant === FIND_SOURCES) return sources
      if (findConstant === FIND_CONSTRUCTION_SITES) return constructionSites
      return roads
    },
  }
}

export function createColonyBenchGame({
  snapshot,
  commands,
  memory,
  apiIntents,
}: CreateColonyBenchGameOptions): ColonyBenchGame {
  const base = snapshot.base
  const sources = snapshot.sources.map(createSource)
  const constructionSites = snapshot.constructionSites.map(createConstructionSite)
  const roads = snapshot.roads.map(createRoad)
  const controller = createController(snapshot.controller, base)
  const terrain = snapshot.terrain ?? []
  const spawns: Record<string, ColonyBenchApiSpawn> = {}
  const creeps: Record<string, ColonyBenchApiCreep> = {}
  const validTargetIds: ColonyBenchApiValidTargetIds = {
    sourceIds: new Set(snapshot.sources.map((source) => source.id)),
    spawnIds: new Set(base ? [base.id] : []),
    constructionSiteIds: new Set(snapshot.constructionSites.map((site) => site.id)),
    roadIds: new Set(snapshot.roads.map((road) => road.id)),
    controllerIds: new Set(snapshot.controller ? [snapshot.controller.id] : []),
  }

  if (base) {
    spawns[base.id] = createSpawn({ base, commands, apiIntents })
    for (const worker of snapshot.workers) {
      creeps[worker.id] = createCreep({
        worker,
        controller,
        commands,
        memory,
        apiIntents,
        validTargetIds,
      })
    }
  }

  return {
    time: snapshot.tick,
    Memory: memory,
    creeps,
    spawns,
    rooms: {
      sim: createRoom({
        sources,
        constructionSites,
        roads,
        controller,
        terrain,
        spawns: Object.values(spawns),
        creeps: Object.values(creeps),
      }),
    },
  }
}

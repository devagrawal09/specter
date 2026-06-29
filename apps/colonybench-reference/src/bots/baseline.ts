import type { ColonyBenchBot } from '../runner/types'
import type {
  ColonyBenchConstructionSite,
  ColonyBenchPosition,
  ColonyBenchRoad,
  ColonyBenchSource,
  ColonyBenchWorker,
} from '../simulation/state'

const SPAWN_WORKER_COST = 10
const TARGET_WORKER_COUNT_BEFORE_UPGRADES = 3

type BaselineWorkerRole = 'harvester' | 'upgrader' | 'builder'

type BaselineCreepMemory = {
  role: BaselineWorkerRole
  saying?: string
}

type BaselineBotMemory = {
  creeps?: Record<string, BaselineCreepMemory>
}

function distance(a: ColonyBenchPosition, b: ColonyBenchPosition) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
}

function isAdjacent(a: ColonyBenchPosition, b: ColonyBenchPosition) {
  return distance(a, b) <= 1
}

function roleForWorker(index: number, workerCount: number): BaselineWorkerRole {
  if (workerCount < TARGET_WORKER_COUNT_BEFORE_UPGRADES) return 'harvester'
  if (index === 0) return 'upgrader'
  if (index === 1) return 'builder'
  return 'harvester'
}

function assignRoles(
  memory: BaselineBotMemory,
  workers: ColonyBenchWorker[],
) {
  const creeps = (memory.creeps ??= {})
  const liveWorkerIds = new Set(workers.map((worker) => worker.id))

  for (const workerId of Object.keys(creeps)) {
    if (!liveWorkerIds.has(workerId)) delete creeps[workerId]
  }

  workers.forEach((worker, index) => {
    creeps[worker.id] = {
      ...creeps[worker.id],
      role: roleForWorker(index, workers.length),
    }
  })
}

function nearestSource(
  worker: ColonyBenchWorker,
  sources: ColonyBenchSource[],
): ColonyBenchSource | undefined {
  return sources
    .filter((source) => source.energy > 0)
    .sort(
      (left, right) =>
        distance(worker.position, left.position) -
          distance(worker.position, right.position) ||
        left.id.localeCompare(right.id),
    )[0]
}


function nearestConstructionSite(
  worker: ColonyBenchWorker,
  sites: ColonyBenchConstructionSite[],
): ColonyBenchConstructionSite | undefined {
  return sites
    .sort(
      (left, right) =>
        distance(worker.position, left.position) -
          distance(worker.position, right.position) ||
        left.id.localeCompare(right.id),
    )[0]
}

function nearestDamagedRoad(
  worker: ColonyBenchWorker,
  roads: ColonyBenchRoad[],
): ColonyBenchRoad | undefined {
  return roads
    .filter((road) => road.hits < road.hitsMax)
    .sort(
      (left, right) =>
        distance(worker.position, left.position) -
          distance(worker.position, right.position) ||
        left.id.localeCompare(right.id),
    )[0]
}

export const baselineBot: ColonyBenchBot<BaselineBotMemory> = {
  loop({ snapshot, commands, memory, game }) {
    const base = snapshot.base
    if (!base) return

    assignRoles(memory, snapshot.workers)

    if (
      base.energy >= SPAWN_WORKER_COST &&
      snapshot.workers.length < TARGET_WORKER_COUNT_BEFORE_UPGRADES
    ) {
      const spawnedWorkerId = `worker-${snapshot.workers.length + 1}`
      memory.creeps ??= {}
      memory.creeps[spawnedWorkerId] = {
        role: roleForWorker(snapshot.workers.length, snapshot.workers.length + 1),
      }
      commands.spawnWorker()
    }

    const controller = game.rooms.sim.controller

    for (const worker of snapshot.workers) {
      const creep = game.creeps[worker.id]
      if (worker.energy > 0) {
        const role = memory.creeps?.[worker.id]?.role ?? 'harvester'
        const site = role === 'builder' ? nearestConstructionSite(worker, snapshot.constructionSites) : undefined
        if (site) {
          if (isAdjacent(worker.position, site.position)) {
            creep?.say(`building ${site.id}`)
            commands.build(worker.id, site.id)
          } else {
            creep?.say(`moving to build ${site.id}`)
            commands.move(worker.id, site.position)
          }
          continue
        }

        const road = role === 'builder' ? nearestDamagedRoad(worker, snapshot.roads) : undefined
        if (road) {
          if (isAdjacent(worker.position, road.position)) {
            const apiRoad = game.rooms.sim.roads.find((candidate) => candidate.id === road.id)
            creep?.say(`repairing ${road.id}`)
            if (apiRoad) creep?.repair(apiRoad)
          } else {
            creep?.say(`moving to repair ${road.id}`)
            commands.move(worker.id, road.position)
          }
          continue
        }

        if (role === 'upgrader') {
          if (isAdjacent(worker.position, controller.pos)) {
            creep?.say('upgrading controller')
            creep?.upgradeController(controller)
          } else {
            creep?.say('returning to controller')
            creep?.moveTo(controller)
          }
        } else if (isAdjacent(worker.position, base.position)) {
          creep?.say('depositing energy')
          commands.deposit(worker.id)
        } else {
          creep?.say('returning to base')
          commands.move(worker.id, base.position)
        }
        continue
      }

      const source = nearestSource(worker, snapshot.sources)
      if (!source) {
        creep?.say('idle: no source')
        continue
      }

      if (isAdjacent(worker.position, source.position)) {
        creep?.say(`harvesting ${source.id}`)
        commands.harvest(worker.id, source.id)
      } else {
        creep?.say(`moving to ${source.id}`)
        commands.move(worker.id, source.position)
      }
    }
  },
}

import type { EventForDefinition } from '@specter-ts/core'

import type {
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
} from './events'
import {
  ROAD_HITS_MAX,
  WORKER_CAPACITY,
  clonePosition,
  createInitialWorld,
  recomputeWorldScore,
  recordWorldEvent,
  type ColonyBenchSimulationState,
} from './state'

function summary<T extends { type: string; payload: unknown }>(event: T) {
  return { type: event.type, payload: event.payload }
}

export async function applySimulationInitialized(
  event: EventForDefinition<typeof simulationInitializedEvent>,
  state: ColonyBenchSimulationState,
) {
  const world = createInitialWorld(event.payload.runId)
  recordWorldEvent(world, summary(event))
  state.worlds[event.payload.runId] = world
}

export async function applyWorkerMoved(
  event: EventForDefinition<typeof workerMovedEvent>,
  state: ColonyBenchSimulationState,
) {
  const world = state.worlds[event.payload.runId]
  const worker = world?.workers[event.payload.workerId]
  if (!world || !worker) return
  worker.position = clonePosition(event.payload.to)
  recordWorldEvent(world, summary(event))
}

export async function applyWorkerHarvested(
  event: EventForDefinition<typeof workerHarvestedEvent>,
  state: ColonyBenchSimulationState,
) {
  const world = state.worlds[event.payload.runId]
  const worker = world?.workers[event.payload.workerId]
  const source = world?.sources[event.payload.sourceId]
  if (!world || !worker || !source) return
  worker.energy += event.payload.amount
  source.energy -= event.payload.amount
  recordWorldEvent(world, summary(event))
}

export async function applyWorkerDeposited(
  event: EventForDefinition<typeof workerDepositedEvent>,
  state: ColonyBenchSimulationState,
) {
  const world = state.worlds[event.payload.runId]
  const worker = world?.workers[event.payload.workerId]
  if (!world || !worker) return
  worker.energy -= event.payload.amount
  world.base.energy += event.payload.amount
  recordWorldEvent(world, summary(event))
}

export async function applyBaseUpgraded(
  event: EventForDefinition<typeof baseUpgradedEvent>,
  state: ColonyBenchSimulationState,
) {
  const world = state.worlds[event.payload.runId]
  const worker = world?.workers[event.payload.workerId]
  if (!world || !worker) return
  worker.energy -= event.payload.amount
  world.base.level = event.payload.level
  world.base.upgradeProgress = event.payload.upgradeProgress
  world.controller.level = event.payload.level
  world.controller.progress = event.payload.upgradeProgress
  recomputeWorldScore(world)
  recordWorldEvent(world, summary(event))
}

export async function applyWorkerSpawned(
  event: EventForDefinition<typeof workerSpawnedEvent>,
  state: ColonyBenchSimulationState,
) {
  const world = state.worlds[event.payload.runId]
  if (!world) return
  world.base.energy -= event.payload.cost
  world.workers[event.payload.workerId] = {
    id: event.payload.workerId,
    position: clonePosition(event.payload.position),
    energy: 0,
    capacity: WORKER_CAPACITY,
  }
  world.workerOrder.push(event.payload.workerId)
  recordWorldEvent(world, summary(event))
}

export async function applyConstructionSiteBuilt(
  event: EventForDefinition<typeof constructionSiteBuiltEvent>,
  state: ColonyBenchSimulationState,
) {
  const world = state.worlds[event.payload.runId]
  const worker = world?.workers[event.payload.workerId]
  const site = world?.constructionSites[event.payload.siteId]
  if (!world || !worker || !site) return
  worker.energy -= event.payload.amount
  site.progress = event.payload.progress
  recordWorldEvent(world, summary(event))
}

export async function applyRoadCompleted(
  event: EventForDefinition<typeof roadCompletedEvent>,
  state: ColonyBenchSimulationState,
) {
  const world = state.worlds[event.payload.runId]
  if (!world) return
  delete world.constructionSites[event.payload.siteId]
  world.constructionSiteOrder = world.constructionSiteOrder.filter(
    (siteId) => siteId !== event.payload.siteId,
  )
  world.roads[event.payload.roadId] = {
    id: event.payload.roadId,
    position: clonePosition(event.payload.position),
    hits: ROAD_HITS_MAX,
    hitsMax: ROAD_HITS_MAX,
  }
  world.roadOrder.push(event.payload.roadId)
  recordWorldEvent(world, summary(event))
}

export async function applyRoadRepaired(
  event: EventForDefinition<typeof roadRepairedEvent>,
  state: ColonyBenchSimulationState,
) {
  const world = state.worlds[event.payload.runId]
  const worker = world?.workers[event.payload.workerId]
  const road = world?.roads[event.payload.roadId]
  if (!world || !worker || !road) return
  worker.energy -= event.payload.amount
  road.hits = event.payload.hits
  recordWorldEvent(world, summary(event))
}

export async function applyCommandRejected(
  event: EventForDefinition<typeof commandRejectedEvent>,
  state: ColonyBenchSimulationState,
) {
  recordWorldEvent(state.worlds[event.payload.runId], summary(event))
}

export async function applyTickAdvanced(
  event: EventForDefinition<typeof tickAdvancedEvent>,
  state: ColonyBenchSimulationState,
) {
  const world = state.worlds[event.payload.runId]
  if (!world) return
  world.tick = event.payload.tick
  for (const regenerated of event.payload.regeneratedSources) {
    const source = world.sources[regenerated.sourceId]
    if (source) source.energy = regenerated.energy
  }
  for (const decayed of event.payload.decayedRoads) {
    const road = world.roads[decayed.roadId]
    if (road) road.hits = decayed.hits
  }
  recordWorldEvent(world, summary(event))
}

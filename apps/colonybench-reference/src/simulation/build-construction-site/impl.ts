import type { EventDraft } from '@specter-ts/core'
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
  buildConstructionSiteSchema,
  isAdjacent,
  rejectCommand,
  roadIdForSite,
} from '../shared'
import { BUILD_AMOUNT, clonePosition } from '../state'
import specification from './spec.json' with { type: 'json' }
import { implementCommand } from '@specter-ts/core'
export const createBuildConstructionSite = implementCommand(specification)
  .inputSchema(buildConstructionSiteSchema)
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
      return rejectCommand(
        command.runId,
        'buildConstructionSite',
        'world_missing',
      )
    const worker = world.workers[command.workerId]
    if (!worker)
      return rejectCommand(
        command.runId,
        'buildConstructionSite',
        'worker_missing',
      )
    const site = world.constructionSites[command.siteId]
    if (!site)
      return rejectCommand(
        command.runId,
        'buildConstructionSite',
        'site_missing',
      )
    if (!isAdjacent(worker.position, site.position)) {
      return rejectCommand(
        command.runId,
        'buildConstructionSite',
        'worker_not_adjacent_to_site',
      )
    }
    if (worker.energy <= 0) {
      return rejectCommand(
        command.runId,
        'buildConstructionSite',
        'worker_empty',
      )
    }
    const amount = Math.min(
      BUILD_AMOUNT,
      worker.energy,
      site.progressTotal - site.progress,
    )
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

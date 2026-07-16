import type { EventDraft } from '@specter-ts/core'
import { z } from 'zod'

import { commandRejectedEvent, positionSchema } from './events'
import type {
  ColonyBenchConstructionSite,
  ColonyBenchPosition,
  ColonyBenchSimulationState,
} from './state'

export type SimulationCommand =
  | 'moveWorker'
  | 'harvestEnergy'
  | 'depositEnergy'
  | 'upgradeBase'
  | 'spawnWorker'
  | 'buildConstructionSite'
  | 'repairRoad'
  | 'advanceTick'

export const runIdSchema = z.object({ runId: z.string() })
export const workerCommandSchema = runIdSchema.extend({ workerId: z.string() })
export const moveWorkerSchema = workerCommandSchema.extend({
  target: positionSchema,
})
export const harvestEnergySchema = workerCommandSchema.extend({
  sourceId: z.string(),
})
export const buildConstructionSiteSchema = workerCommandSchema.extend({
  siteId: z.string(),
})
export const repairRoadSchema = workerCommandSchema.extend({
  roadId: z.string(),
})

export function rejectCommand(
  runId: string,
  command: SimulationCommand,
  reason: string,
): EventDraft[] {
  return [commandRejectedEvent.create({ runId, command, reason })]
}

export function stepToward(
  from: ColonyBenchPosition,
  target: ColonyBenchPosition,
) {
  return {
    x: from.x + Math.sign(target.x - from.x),
    y: from.y + Math.sign(target.y - from.y),
  }
}

export function isAdjacent(a: ColonyBenchPosition, b: ColonyBenchPosition) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) <= 1
}

export function isWallTerrain(
  terrain: ColonyBenchSimulationState['worlds'][string]['terrain'],
  position: ColonyBenchPosition,
) {
  return Object.values(terrain).some(
    (tile) =>
      tile.terrain === 'wall' &&
      tile.position.x === position.x &&
      tile.position.y === position.y,
  )
}

export function roadIdForSite(
  site: ColonyBenchConstructionSite,
  existingRoadCount: number,
) {
  const suffix = site.id.match(/(\d+)$/)?.[1]
  return suffix ? `road-${suffix}` : `road-${existingRoadCount + 1}`
}

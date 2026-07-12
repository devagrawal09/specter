import { createEventDefinition } from '@specter-ts/core'
import { z } from 'zod'

export const positionSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
})

export const simulationInitializedEvent = createEventDefinition(
  'colonybenchSimulationInitialized',
  z.object({
    runId: z.string(),
  }),
)

export const workerMovedEvent = createEventDefinition(
  'colonybenchWorkerMoved',
  z.object({
    runId: z.string(),
    workerId: z.string(),
    from: positionSchema,
    to: positionSchema,
    target: positionSchema,
  }),
)

export const workerHarvestedEvent = createEventDefinition(
  'colonybenchWorkerHarvested',
  z.object({
    runId: z.string(),
    workerId: z.string(),
    sourceId: z.string(),
    amount: z.number().int().nonnegative(),
  }),
)

export const workerDepositedEvent = createEventDefinition(
  'colonybenchWorkerDeposited',
  z.object({
    runId: z.string(),
    workerId: z.string(),
    amount: z.number().int().nonnegative(),
  }),
)

export const baseUpgradedEvent = createEventDefinition(
  'colonybenchBaseUpgraded',
  z.object({
    runId: z.string(),
    workerId: z.string(),
    amount: z.number().int().nonnegative(),
    level: z.number().int().positive(),
    upgradeProgress: z.number().int().nonnegative(),
  }),
)

export const workerSpawnedEvent = createEventDefinition(
  'colonybenchWorkerSpawned',
  z.object({
    runId: z.string(),
    workerId: z.string(),
    cost: z.number().int().nonnegative(),
    position: positionSchema,
  }),
)


export const constructionSiteBuiltEvent = createEventDefinition(
  'colonybenchConstructionSiteBuilt',
  z.object({
    runId: z.string(),
    workerId: z.string(),
    siteId: z.string(),
    amount: z.number().int().nonnegative(),
    progress: z.number().int().nonnegative(),
    completed: z.boolean(),
  }),
)

export const roadCompletedEvent = createEventDefinition(
  'colonybenchRoadCompleted',
  z.object({
    runId: z.string(),
    siteId: z.string(),
    roadId: z.string(),
    position: positionSchema,
  }),
)

export const roadRepairedEvent = createEventDefinition(
  'colonybenchRoadRepaired',
  z.object({
    runId: z.string(),
    workerId: z.string(),
    roadId: z.string(),
    amount: z.number().int().nonnegative(),
    hits: z.number().int().nonnegative(),
  }),
)

export const commandRejectedEvent = createEventDefinition(
  'colonybenchCommandRejected',
  z.object({
    runId: z.string(),
    command: z.string(),
    reason: z.string(),
  }),
)

export const tickAdvancedEvent = createEventDefinition(
  'colonybenchTickAdvanced',
  z.object({
    runId: z.string(),
    tick: z.number().int().nonnegative(),
    regeneratedSources: z.array(
      z.object({
        sourceId: z.string(),
        amount: z.number().int().nonnegative(),
        energy: z.number().int().nonnegative(),
      }),
    ),
    decayedRoads: z.array(
      z.object({
        roadId: z.string(),
        amount: z.number().int().nonnegative(),
        hits: z.number().int().nonnegative(),
      }),
    ),
  }),
)

export const simulationEventDefinitions = [
  simulationInitializedEvent,
  workerMovedEvent,
  workerHarvestedEvent,
  workerDepositedEvent,
  baseUpgradedEvent,
  workerSpawnedEvent,
  constructionSiteBuiltEvent,
  roadCompletedEvent,
  roadRepairedEvent,
  commandRejectedEvent,
  tickAdvancedEvent,
] as const

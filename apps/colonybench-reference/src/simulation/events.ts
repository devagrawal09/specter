import { createEventDefinition } from '@specter-ts/core'
import { z } from 'zod'

export const positionSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
})

export const simulationInitializedEvent = createEventDefinition(
  'colonybench-simulation-initialized',
  z.object({
    runId: z.string(),
  }),
)

export const workerMovedEvent = createEventDefinition(
  'colonybench-worker-moved',
  z.object({
    runId: z.string(),
    workerId: z.string(),
    from: positionSchema,
    to: positionSchema,
    target: positionSchema,
  }),
)

export const workerHarvestedEvent = createEventDefinition(
  'colonybench-worker-harvested',
  z.object({
    runId: z.string(),
    workerId: z.string(),
    sourceId: z.string(),
    amount: z.number().int().nonnegative(),
  }),
)

export const workerDepositedEvent = createEventDefinition(
  'colonybench-worker-deposited',
  z.object({
    runId: z.string(),
    workerId: z.string(),
    amount: z.number().int().nonnegative(),
  }),
)

export const baseUpgradedEvent = createEventDefinition(
  'colonybench-base-upgraded',
  z.object({
    runId: z.string(),
    workerId: z.string(),
    amount: z.number().int().nonnegative(),
    level: z.number().int().positive(),
    upgradeProgress: z.number().int().nonnegative(),
  }),
)

export const workerSpawnedEvent = createEventDefinition(
  'colonybench-worker-spawned',
  z.object({
    runId: z.string(),
    workerId: z.string(),
    cost: z.number().int().nonnegative(),
    position: positionSchema,
  }),
)

export const constructionSiteBuiltEvent = createEventDefinition(
  'colonybench-construction-site-built',
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
  'colonybench-road-completed',
  z.object({
    runId: z.string(),
    siteId: z.string(),
    roadId: z.string(),
    position: positionSchema,
  }),
)

export const roadRepairedEvent = createEventDefinition(
  'colonybench-road-repaired',
  z.object({
    runId: z.string(),
    workerId: z.string(),
    roadId: z.string(),
    amount: z.number().int().nonnegative(),
    hits: z.number().int().nonnegative(),
  }),
)

export const commandRejectedEvent = createEventDefinition(
  'colonybench-command-rejected',
  z.object({
    runId: z.string(),
    command: z.string(),
    reason: z.string(),
  }),
)

export const tickAdvancedEvent = createEventDefinition(
  'colonybench-tick-advanced',
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

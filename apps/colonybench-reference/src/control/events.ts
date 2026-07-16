import { createEventDefinition } from '@specter-ts/core'
import { z } from 'zod'

export const runCreatedEvent = createEventDefinition(
  'colonybench-run-created',
  z.object({
    runId: z.string(),
    name: z.string(),
  }),
)

export const runStartedEvent = createEventDefinition(
  'colonybench-run-started',
  z.object({
    runId: z.string(),
  }),
)

export const runCompletedEvent = createEventDefinition(
  'colonybench-run-completed',
  z.object({
    runId: z.string(),
  }),
)

export const runFrameRecordedEvent = createEventDefinition(
  'colonybench-run-frame-recorded',
  z.object({
    runId: z.string(),
    tick: z.number().int().nonnegative(),
    score: z.number(),
    workerCount: z.number().int().nonnegative(),
    baseLevel: z.number().int().nonnegative(),
    baseEnergy: z.number().nonnegative(),
    commandCount: z.number().int().nonnegative(),
    eventTypes: z.array(z.string()),
  }),
)

export const controlEventDefinitions = [
  runCreatedEvent,
  runStartedEvent,
  runCompletedEvent,
  runFrameRecordedEvent,
] as const

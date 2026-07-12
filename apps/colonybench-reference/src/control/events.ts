import { createEventDefinition } from '@specter-ts/core'
import { z } from 'zod'

export const runCreatedEvent = createEventDefinition(
  'colonybenchRunCreated',
  z.object({
    runId: z.string(),
    name: z.string(),
  }),
)

export const runStartedEvent = createEventDefinition(
  'colonybenchRunStarted',
  z.object({
    runId: z.string(),
  }),
)

export const runCompletedEvent = createEventDefinition(
  'colonybenchRunCompleted',
  z.object({
    runId: z.string(),
  }),
)

export const runFrameRecordedEvent = createEventDefinition(
  'colonybenchRunFrameRecorded',
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

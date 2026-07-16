import { createEventDefinition } from '@specter-ts/core'
import { z } from 'zod'

export const demoCreatedEvent = createEventDefinition(
  'demo-created',
  z.object({
    demoId: z.string(),
    projectId: z.string(),
    title: z.string(),
  }),
)

export const demoStageAddedEvent = createEventDefinition(
  'demo-stage-added',
  z.object({
    demoId: z.string(),
    stageId: z.string(),
    title: z.string(),
    order: z.number().int().nonnegative(),
  }),
)

export const demoStageReorderedEvent = createEventDefinition(
  'demo-stage-reordered',
  z.object({
    demoId: z.string(),
    stageId: z.string(),
    order: z.number().int().nonnegative(),
  }),
)

export const demoStepAddedEvent = createEventDefinition(
  'demo-step-added',
  z.object({
    demoId: z.string(),
    stageId: z.string(),
    stepId: z.string(),
    instruction: z.string(),
    expectedOutput: z.string(),
  }),
)

export const demoRehearsalCompletedEvent = createEventDefinition(
  'demo-rehearsal-completed',
  z.object({
    demoId: z.string(),
    rehearsedAt: z.string(),
    notes: z.string(),
  }),
)

export const demoEventDefinitions = [
  demoCreatedEvent,
  demoStageAddedEvent,
  demoStageReorderedEvent,
  demoStepAddedEvent,
  demoRehearsalCompletedEvent,
] as const

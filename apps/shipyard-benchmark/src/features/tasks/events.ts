import { createEventDefinition } from '@specter-ts/core'
import { z } from 'zod'

export const taskCreatedEvent = createEventDefinition(
  'taskCreated',
  z.object({
    taskId: z.string(),
    title: z.string(),
    linkedProjectId: z.string().optional(),
    status: z.literal('inbox'),
  }),
)

export const taskTriagedEvent = createEventDefinition(
  'taskTriaged',
  z.object({
    taskId: z.string(),
    priority: z.enum(['low', 'medium', 'high']),
  }),
)

export const taskStartedEvent = createEventDefinition(
  'taskStarted',
  z.object({
    taskId: z.string(),
    startedAt: z.string(),
  }),
)

export const taskCompletionRequestedEvent = createEventDefinition(
  'taskCompletionRequested',
  z.object({
    taskId: z.string(),
    requestedByRunId: z.string().optional(),
    evidence: z.string(),
  }),
)

export const taskCompletedEvent = createEventDefinition(
  'taskCompleted',
  z.object({
    taskId: z.string(),
    completedAt: z.string(),
  }),
)

export const taskRolledForwardEvent = createEventDefinition(
  'taskRolledForward',
  z.object({
    taskId: z.string(),
    fromDate: z.string(),
    toDate: z.string(),
  }),
)

export const scoreAwardRequestedEvent = createEventDefinition(
  'scoreAwardRequested',
  z.object({
    scoreRequestId: z.string(),
    taskId: z.string(),
    points: z.number().int().positive(),
    reason: z.string(),
  }),
)

export const scoreAwardedEvent = createEventDefinition(
  'scoreAwarded',
  z.object({
    scoreRequestId: z.string(),
    taskId: z.string(),
    points: z.number().int().positive(),
    awardedAt: z.string(),
  }),
)

export const taskEventDefinitions = [
  taskCreatedEvent,
  taskTriagedEvent,
  taskStartedEvent,
  taskCompletionRequestedEvent,
  taskCompletedEvent,
  taskRolledForwardEvent,
  scoreAwardRequestedEvent,
  scoreAwardedEvent,
] as const

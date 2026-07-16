import { createEventDefinition } from '@specter-ts/core'
import { z } from 'zod'

export const taskCreatedEvent = createEventDefinition(
  'task-created',
  z.object({
    taskId: z.string(),
    title: z.string(),
    linkedProjectId: z.string().optional(),
    status: z.literal('inbox'),
  }),
)

export const taskTriagedEvent = createEventDefinition(
  'task-triaged',
  z.object({
    taskId: z.string(),
    priority: z.enum(['low', 'medium', 'high']),
  }),
)

export const taskStartedEvent = createEventDefinition(
  'task-started',
  z.object({
    taskId: z.string(),
    startedAt: z.string(),
  }),
)

export const taskCompletionRequestedEvent = createEventDefinition(
  'task-completion-requested',
  z.object({
    taskId: z.string(),
    requestedByRunId: z.string().optional(),
    evidence: z.string(),
  }),
)

export const taskCompletedEvent = createEventDefinition(
  'task-completed',
  z.object({
    taskId: z.string(),
    completedAt: z.string(),
  }),
)

export const taskRolledForwardEvent = createEventDefinition(
  'task-rolled-forward',
  z.object({
    taskId: z.string(),
    fromDate: z.string(),
    toDate: z.string(),
  }),
)

export const scoreAwardRequestedEvent = createEventDefinition(
  'score-award-requested',
  z.object({
    scoreRequestId: z.string(),
    taskId: z.string(),
    points: z.number().int().positive(),
    reason: z.string(),
  }),
)

export const scoreAwardedEvent = createEventDefinition(
  'score-awarded',
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

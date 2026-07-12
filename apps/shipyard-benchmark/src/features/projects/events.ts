import { createEventDefinition } from '@specter-ts/core'
import { z } from 'zod'

export const projectCreatedEvent = createEventDefinition(
  'projectCreated',
  z.object({
    projectId: z.string(),
    opportunityId: z.string().optional(),
    title: z.string(),
    status: z.literal('idea'),
  }),
)

export const projectStatusUpdatedEvent = createEventDefinition(
  'projectStatusUpdated',
  z.object({
    projectId: z.string(),
    status: z.enum(['idea', 'active', 'polish', 'shipped', 'archived']),
  }),
)

export const projectMilestoneAddedEvent = createEventDefinition(
  'projectMilestoneAdded',
  z.object({
    projectId: z.string(),
    milestoneId: z.string(),
    title: z.string(),
  }),
)

export const projectMilestoneCompletedEvent = createEventDefinition(
  'projectMilestoneCompleted',
  z.object({
    projectId: z.string(),
    milestoneId: z.string(),
    completedAt: z.string(),
  }),
)

export const projectLinkAddedEvent = createEventDefinition(
  'projectLinkAdded',
  z.object({
    projectId: z.string(),
    label: z.string(),
    url: z.string(),
  }),
)

export const projectEventDefinitions = [
  projectCreatedEvent,
  projectStatusUpdatedEvent,
  projectMilestoneAddedEvent,
  projectMilestoneCompletedEvent,
  projectLinkAddedEvent,
] as const

import { createEventDefinition } from '@specter-ts/core'
import { z } from 'zod'

export const projectCreatedEvent = createEventDefinition(
  'project-created',
  z.object({
    projectId: z.string(),
    opportunityId: z.string().optional(),
    title: z.string(),
    status: z.literal('idea'),
  }),
)

export const projectStatusUpdatedEvent = createEventDefinition(
  'project-status-updated',
  z.object({
    projectId: z.string(),
    status: z.enum(['idea', 'active', 'polish', 'shipped', 'archived']),
  }),
)

export const projectMilestoneAddedEvent = createEventDefinition(
  'project-milestone-added',
  z.object({
    projectId: z.string(),
    milestoneId: z.string(),
    title: z.string(),
  }),
)

export const projectMilestoneCompletedEvent = createEventDefinition(
  'project-milestone-completed',
  z.object({
    projectId: z.string(),
    milestoneId: z.string(),
    completedAt: z.string(),
  }),
)

export const projectLinkAddedEvent = createEventDefinition(
  'project-link-added',
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

import { createEventDefinition } from '@specter-ts/core'
import { z } from 'zod'

export const opportunityCreatedEvent = createEventDefinition(
  'opportunity-created',
  z.object({
    opportunityId: z.string(),
    title: z.string(),
    description: z.string(),
    source: z.enum(['manual', 'github', 'opencode']),
    status: z.literal('captured'),
    priority: z.enum(['low', 'medium', 'high']),
  }),
)

export const opportunityUpdatedEvent = createEventDefinition(
  'opportunity-updated',
  z.object({
    opportunityId: z.string(),
    title: z.string().optional(),
    description: z.string().optional(),
    status: z.enum(['captured', 'researched', 'selected']).optional(),
  }),
)

export const opportunityPrioritizedEvent = createEventDefinition(
  'opportunity-prioritized',
  z.object({
    opportunityId: z.string(),
    priority: z.enum(['low', 'medium', 'high']),
    reason: z.string(),
  }),
)

export const opportunityArchivedEvent = createEventDefinition(
  'opportunity-archived',
  z.object({
    opportunityId: z.string(),
    reason: z.string(),
  }),
)

export const opportunityConversionRequestedEvent = createEventDefinition(
  'opportunity-conversion-requested',
  z.object({
    opportunityId: z.string(),
    requestedBy: z.string(),
  }),
)

export const opportunityConvertedToProjectEvent = createEventDefinition(
  'opportunity-converted-to-project',
  z.object({
    opportunityId: z.string(),
    projectId: z.string(),
  }),
)

export const opportunityEventDefinitions = [
  opportunityCreatedEvent,
  opportunityUpdatedEvent,
  opportunityPrioritizedEvent,
  opportunityArchivedEvent,
  opportunityConversionRequestedEvent,
  opportunityConvertedToProjectEvent,
] as const

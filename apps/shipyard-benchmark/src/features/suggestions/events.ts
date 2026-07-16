import { createEventDefinition } from '@specter-ts/core'
import { z } from 'zod'

export const agentSuggestionRecordedEvent = createEventDefinition(
  'agent-suggestion-recorded',
  z.object({
    suggestionId: z.string(),
    sourceRunId: z.string(),
    kind: z.enum([
      'opportunity',
      'project',
      'milestone',
      'task',
      'demo',
      'demo_stage',
      'artifact',
    ]),
    title: z.string(),
    body: z.string(),
  }),
)

export const agentSuggestionAppliedEvent = createEventDefinition(
  'agent-suggestion-applied',
  z.object({
    suggestionId: z.string(),
    appliedAt: z.string(),
    resultingEntityId: z.string().optional(),
  }),
)

export const agentSuggestionRejectedEvent = createEventDefinition(
  'agent-suggestion-rejected',
  z.object({
    suggestionId: z.string(),
    rejectedAt: z.string(),
    reason: z.string(),
  }),
)

export const suggestionEventDefinitions = [
  agentSuggestionRecordedEvent,
  agentSuggestionAppliedEvent,
  agentSuggestionRejectedEvent,
] as const

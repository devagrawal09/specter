import { createEventDefinition } from '@specter-ts/core'
import { z } from 'zod'

const linkedEntitySchema = z.object({
  type: z.enum(['opportunity', 'project', 'task', 'demo']),
  id: z.string(),
})

const envelopeFields = {
  eventId: z.string(),
  runId: z.string().optional(),
  clientRunId: z.string().optional(),
  sequence: z.number().int().nonnegative().optional(),
  occurredAt: z.string(),
  linkedEntity: linkedEntitySchema.optional(),
}

export const opencodeRunRequestedEvent = createEventDefinition(
  'opencode-run-requested',
  z.object({
    ...envelopeFields,
    operation: z.literal('opencode.run.start'),
    prompt: z.string(),
    workingDirectory: z.string(),
  }),
)

export const opencodeRunStartedEvent = createEventDefinition(
  'opencode-run-started',
  z.object({
    ...envelopeFields,
    inboundName: z.literal('opencode.run.started'),
    runId: z.string(),
    status: z.literal('running'),
  }),
)

export const opencodeRunStatusChangedEvent = createEventDefinition(
  'opencode-run-status-changed',
  z.object({
    ...envelopeFields,
    inboundName: z.literal('opencode.run.status_changed'),
    runId: z.string(),
    status: z.enum([
      'queued',
      'running',
      'waiting_for_input',
      'completed',
      'failed',
      'cancelled',
    ]),
  }),
)

export const opencodeLogAppendedEvent = createEventDefinition(
  'opencode-log-appended',
  z.object({
    ...envelopeFields,
    inboundName: z.literal('opencode.log.appended'),
    runId: z.string(),
    level: z.enum(['debug', 'info', 'warn', 'error']),
    message: z.string(),
  }),
)

export const opencodeToolCompletedEvent = createEventDefinition(
  'opencode-tool-completed',
  z.object({
    ...envelopeFields,
    inboundName: z.literal('opencode.tool.completed'),
    runId: z.string(),
    toolCallId: z.string(),
    toolName: z.string(),
    status: z.enum(['completed', 'failed']),
    summary: z.string().optional(),
  }),
)

export const opencodeFileChangedEvent = createEventDefinition(
  'opencode-file-changed',
  z.object({
    ...envelopeFields,
    inboundName: z.literal('opencode.file.changed'),
    runId: z.string(),
    path: z.string(),
    changeKind: z.enum(['created', 'modified', 'deleted']),
  }),
)

export const opencodeSuggestionCreatedEvent = createEventDefinition(
  'opencode-suggestion-created',
  z.object({
    ...envelopeFields,
    inboundName: z.literal('opencode.suggestion.created'),
    runId: z.string(),
    suggestionId: z.string(),
    suggestionKind: z.enum([
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

export const opencodeRunCompletedEvent = createEventDefinition(
  'opencode-run-completed',
  z.object({
    ...envelopeFields,
    inboundName: z.literal('opencode.run.completed'),
    runId: z.string(),
    summary: z.string().optional(),
  }),
)

export const opencodeRunFailedEvent = createEventDefinition(
  'opencode-run-failed',
  z.object({
    ...envelopeFields,
    inboundName: z.literal('opencode.run.failed'),
    runId: z.string(),
    error: z.string(),
  }),
)

export const opencodeEventDefinitions = [
  opencodeRunRequestedEvent,
  opencodeRunStartedEvent,
  opencodeRunStatusChangedEvent,
  opencodeLogAppendedEvent,
  opencodeToolCompletedEvent,
  opencodeFileChangedEvent,
  opencodeSuggestionCreatedEvent,
  opencodeRunCompletedEvent,
  opencodeRunFailedEvent,
] as const

export type OpenCodeEvent =
  | ReturnType<typeof opencodeRunRequestedEvent.create>
  | ReturnType<typeof opencodeRunStartedEvent.create>
  | ReturnType<typeof opencodeRunStatusChangedEvent.create>
  | ReturnType<typeof opencodeLogAppendedEvent.create>
  | ReturnType<typeof opencodeToolCompletedEvent.create>
  | ReturnType<typeof opencodeFileChangedEvent.create>
  | ReturnType<typeof opencodeSuggestionCreatedEvent.create>
  | ReturnType<typeof opencodeRunCompletedEvent.create>
  | ReturnType<typeof opencodeRunFailedEvent.create>

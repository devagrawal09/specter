import z from 'zod'
import { createEventSpec } from '../../lib'
import type { HarlanRuntimeEvent } from './runtime/events'

export const harlanSessionStartedEvent = createEventSpec(
  'harlanSessionStarted',
  z.object({
    sessionPath: z.string().min(1),
    title: z.string().min(1).optional(),
  }),
)

export const harlanUserMessagedEvent = createEventSpec(
  'harlanUserMessaged',
  z.object({
    sessionPath: z.string().min(1),
    message: z.string(),
  }),
)

export const harlanAgentContextCreatedEvent = createEventSpec(
  'harlanAgentContextCreated',
  z.object({
    sessionPath: z.string().min(1),
    agentContextId: z.string().min(1),
    model: z.string().min(1).optional(),
    context: z.record(z.string(), z.unknown()).optional(),
  }),
)

export const harlanAgentStartedThinkingEvent = createEventSpec(
  'harlanAgentStartedThinking',
  z.object({
    sessionPath: z.string().min(1),
    agentContextId: z.string().min(1),
    prompt: z.string().optional(),
  }),
)

export const harlanAgentFinishedThinkingEvent = createEventSpec(
  'harlanAgentFinishedThinking',
  z.object({
    sessionPath: z.string().min(1),
    agentContextId: z.string().min(1),
    thought: z.string().optional(),
  }),
)

export const harlanAgentStartedScriptingEvent = createEventSpec(
  'harlanAgentStartedScripting',
  z.object({
    sessionPath: z.string().min(1),
    agentContextId: z.string().min(1),
  }),
)

export const harlanAgentFinishedScriptingEvent = createEventSpec(
  'harlanAgentFinishedScripting',
  z.object({
    sessionPath: z.string().min(1),
    agentContextId: z.string().min(1),
    code: z.string(),
  }),
)

export const harlanAgentStartedRespondingEvent = createEventSpec(
  'harlanAgentStartedResponding',
  z.object({
    sessionPath: z.string().min(1),
    agentContextId: z.string().min(1),
  }),
)

export const harlanAgentFinishedRespondingEvent = createEventSpec(
  'harlanAgentFinishedResponding',
  z.object({
    sessionPath: z.string().min(1),
    agentContextId: z.string().min(1),
    response: z.string(),
  }),
)

export const harlanAgentContextSavedEvent = createEventSpec(
  'harlanAgentContextSaved',
  z.object({
    sessionPath: z.string().min(1),
    agentContextId: z.string().min(1),
    context: z.record(z.string(), z.unknown()),
  }),
)

export type HarlanEvent =
  | ReturnType<typeof harlanSessionStartedEvent.create>
  | ReturnType<typeof harlanUserMessagedEvent.create>
  | ReturnType<typeof harlanAgentContextCreatedEvent.create>
  | ReturnType<typeof harlanAgentStartedThinkingEvent.create>
  | ReturnType<typeof harlanAgentFinishedThinkingEvent.create>
  | ReturnType<typeof harlanAgentStartedScriptingEvent.create>
  | ReturnType<typeof harlanAgentFinishedScriptingEvent.create>
  | ReturnType<typeof harlanAgentStartedRespondingEvent.create>
  | ReturnType<typeof harlanAgentFinishedRespondingEvent.create>
  | ReturnType<typeof harlanAgentContextSavedEvent.create>
  | HarlanRuntimeEvent

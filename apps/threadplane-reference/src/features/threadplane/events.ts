import { createEventDefinition } from '@specter-ts/core'
import { z } from 'zod'

export const workspaceCreatedEvent = createEventDefinition(
  'workspaceCreated',
  z.object({
    workspaceId: z.string(),
    name: z.string(),
    createdBy: z
      .object({
        userId: z.string().optional(),
        displayName: z.string(),
      })
      .optional(),
  }),
)

export const postCreatedEvent = createEventDefinition(
  'postCreated',
  z.object({
    postId: z.string(),
    workspaceId: z.string(),
    author: z.object({
      type: z.enum(['user', 'agent']),
      displayName: z.string(),
      agentId: z.string().optional(),
    }),
    content: z.string(),
  }),
)

export const repliedToPostEvent = createEventDefinition(
  'repliedToPost',
  z.object({
    replyId: z.string(),
    workspaceId: z.string(),
    postId: z.string(),
    parentPostId: z.string(),
    author: z.object({
      type: z.enum(['user', 'agent']),
      displayName: z.string(),
      agentId: z.string().optional(),
    }),
    content: z.string(),
  }),
)

export const agentTriggeredEvent = createEventDefinition(
  'agentTriggered',
  z.object({
    triggerId: z.string(),
    workspaceId: z.string(),
    postId: z.string(),
    agentId: z.string(),
    agentName: z.string(),
  }),
)

export const agentRunRequestedEvent = createEventDefinition(
  'agentRunRequested',
  z.object({
    runId: z.string(),
    workspaceId: z.string(),
    postId: z.string().optional(),
    agentId: z.string(),
    agentName: z.string(),
    requestedBy: z.object({
      type: z.enum(['user', 'workspace', 'system']),
      userId: z.string().optional(),
      displayName: z.string().optional(),
    }),
  }),
)

export const agentRunStartedEvent = createEventDefinition(
  'agentRunStarted',
  z.object({
    runId: z.string(),
    workspaceId: z.string(),
    agentId: z.string(),
  }),
)

export const agentRunStreamedEvent = createEventDefinition(
  'agentRunStreamed',
  z.object({
    runId: z.string(),
    workspaceId: z.string(),
    agentId: z.string(),
    chunkId: z.string(),
    delta: z.string(),
  }),
)

export const agentRunCompletedEvent = createEventDefinition(
  'agentRunCompleted',
  z.object({
    runId: z.string(),
    workspaceId: z.string(),
    agentId: z.string(),
  }),
)

export const agentRunFailedEvent = createEventDefinition(
  'agentRunFailed',
  z.object({
    runId: z.string(),
    workspaceId: z.string(),
    agentId: z.string(),
    error: z.string(),
  }),
)

export const toolCallStartedEvent = createEventDefinition(
  'toolCallStarted',
  z.object({
    toolCallId: z.string(),
    runId: z.string(),
    workspaceId: z.string(),
    agentId: z.string(),
    toolName: z.string(),
    input: z.unknown(),
  }),
)

export const toolCallCompletedEvent = createEventDefinition(
  'toolCallCompleted',
  z.object({
    toolCallId: z.string(),
    runId: z.string(),
    workspaceId: z.string(),
    agentId: z.string(),
    toolName: z.string(),
    output: z.unknown(),
  }),
)

export const toolCallFailedEvent = createEventDefinition(
  'toolCallFailed',
  z.object({
    toolCallId: z.string(),
    runId: z.string(),
    workspaceId: z.string(),
    agentId: z.string(),
    toolName: z.string(),
    error: z.string(),
  }),
)

export const threadplaneEventDefinitions = [
  workspaceCreatedEvent,
  postCreatedEvent,
  repliedToPostEvent,
  agentTriggeredEvent,
  agentRunRequestedEvent,
  agentRunStartedEvent,
  agentRunStreamedEvent,
  agentRunCompletedEvent,
  agentRunFailedEvent,
  toolCallStartedEvent,
  toolCallCompletedEvent,
  toolCallFailedEvent,
] as const

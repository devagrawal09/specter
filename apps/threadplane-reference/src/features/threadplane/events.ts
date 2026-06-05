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

export const agentReasonedEvent = createEventDefinition(
  'agentReasoned',
  z.object({
    reasoningId: z.string(),
    triggerId: z.string(),
    workspaceId: z.string(),
    agentId: z.string(),
    content: z.string(),
  }),
)

export const agentCalledToolEvent = createEventDefinition(
  'agentCalledTool',
  z.object({
    toolCallId: z.string(),
    triggerId: z.string(),
    workspaceId: z.string(),
    agentId: z.string(),
    toolName: z.string(),
    input: z.unknown(),
  }),
)

export const agentRespondedEvent = createEventDefinition(
  'agentResponded',
  z.object({
    responseId: z.string(),
    triggerId: z.string(),
    workspaceId: z.string(),
    agentId: z.string(),
    content: z.string(),
    postId: z.string().optional(),
  }),
)

export const threadplaneEventDefinitions = [
  workspaceCreatedEvent,
  postCreatedEvent,
  repliedToPostEvent,
  agentTriggeredEvent,
  agentReasonedEvent,
  agentCalledToolEvent,
  agentRespondedEvent,
] as const

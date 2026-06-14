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
    author: z.discriminatedUnion('type', [
      z.object({
        type: z.literal('user'),
        userId: z.string().optional(),
        displayName: z.string(),
      }),
      z.object({
        type: z.literal('agent'),
        agentId: z.string(),
        displayName: z.string(),
      }),
    ]),
    content: z.string(),
    sourceRunId: z.string().optional(),
  }),
)

export const postReplyCreatedEvent = createEventDefinition(
  'postReplyCreated',
  z.object({
    replyId: z.string(),
    workspaceId: z.string(),
    parentPostId: z.string(),
    author: z.discriminatedUnion('type', [
      z.object({
        type: z.literal('user'),
        userId: z.string().optional(),
        displayName: z.string(),
      }),
      z.object({
        type: z.literal('agent'),
        agentId: z.string(),
        displayName: z.string(),
      }),
    ]),
    content: z.string(),
    sourceRunId: z.string().optional(),
  }),
)

export const workspaceFilesystemInitializedEvent = createEventDefinition(
  'workspaceFilesystemInitialized',
  z.object({
    workspaceId: z.string(),
  }),
)

export const workspaceFilesystemScanRequestedEvent = createEventDefinition(
  'workspaceFilesystemScanRequested',
  z.object({
    scanId: z.string(),
    workspaceId: z.string(),
    reason: z.enum(['workspaceCreated', 'userRequested', 'agentToolChanged']),
    requestedBy: z.discriminatedUnion('type', [
      z.object({
        type: z.literal('user'),
        userId: z.string().optional(),
        displayName: z.string(),
      }),
      z.object({
        type: z.literal('agent'),
        agentId: z.string(),
        displayName: z.string(),
      }),
      z.object({
        type: z.literal('system'),
      }),
    ]),
  }),
)

export const workspaceFilesystemScanStartedEvent = createEventDefinition(
  'workspaceFilesystemScanStarted',
  z.object({
    scanId: z.string(),
    workspaceId: z.string(),
  }),
)

export const workspaceFilesystemScanCompletedEvent = createEventDefinition(
  'workspaceFilesystemScanCompleted',
  z.object({
    scanId: z.string(),
    workspaceId: z.string(),
    discoveredNodeCount: z.number().int().nonnegative(),
    changedNodeCount: z.number().int().nonnegative(),
    deletedNodeCount: z.number().int().nonnegative(),
  }),
)

export const workspaceFilesystemScanFailedEvent = createEventDefinition(
  'workspaceFilesystemScanFailed',
  z.object({
    scanId: z.string(),
    workspaceId: z.string(),
    error: z.string(),
  }),
)

export const filesystemNodeDiscoveredEvent = createEventDefinition(
  'filesystemNodeDiscovered',
  z.object({
    scanId: z.string(),
    workspaceId: z.string(),
    path: z.string(),
    parentPath: z.string().nullable(),
    name: z.string(),
    kind: z.enum(['file', 'directory']),
    sizeBytes: z.number().int().nonnegative().nullable(),
    modifiedAt: z.string().optional(),
  }),
)

export const filesystemNodeChangedEvent = createEventDefinition(
  'filesystemNodeChanged',
  z.object({
    scanId: z.string(),
    workspaceId: z.string(),
    path: z.string(),
    parentPath: z.string().nullable(),
    name: z.string(),
    kind: z.enum(['file', 'directory']),
    sizeBytes: z.number().int().nonnegative().nullable(),
    modifiedAt: z.string().optional(),
  }),
)

export const filesystemNodeDeletedEvent = createEventDefinition(
  'filesystemNodeDeleted',
  z.object({
    scanId: z.string(),
    workspaceId: z.string(),
    path: z.string(),
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
    requestedBy: z.discriminatedUnion('type', [
      z.object({
        type: z.literal('user'),
        userId: z.string().optional(),
        displayName: z.string(),
      }),
      z.object({
        type: z.literal('agent'),
        agentId: z.string(),
        displayName: z.string(),
      }),
      z.object({
        type: z.literal('system'),
      }),
    ]),
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
    sequence: z.number().int().nonnegative(),
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
    inputSummary: z.string().optional(),
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
    outputSummary: z.string().optional(),
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
  postReplyCreatedEvent,
  workspaceFilesystemInitializedEvent,
  workspaceFilesystemScanRequestedEvent,
  workspaceFilesystemScanStartedEvent,
  workspaceFilesystemScanCompletedEvent,
  workspaceFilesystemScanFailedEvent,
  filesystemNodeDiscoveredEvent,
  filesystemNodeChangedEvent,
  filesystemNodeDeletedEvent,
  agentRunRequestedEvent,
  agentRunStartedEvent,
  agentRunStreamedEvent,
  agentRunCompletedEvent,
  agentRunFailedEvent,
  toolCallStartedEvent,
  toolCallCompletedEvent,
  toolCallFailedEvent,
] as const

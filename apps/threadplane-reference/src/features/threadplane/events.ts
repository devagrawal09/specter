import { createEventDefinition } from "@specter-ts/core";
import { z } from "zod";

export const workspaceCreatedEvent = createEventDefinition(
  "workspace-created",
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
);

export const postCreatedEvent = createEventDefinition(
  "post-created",
  z.object({
    postId: z.string(),
    workspaceId: z.string(),
    author: z.discriminatedUnion("type", [
      z.object({
        type: z.literal("user"),
        userId: z.string().optional(),
        displayName: z.string(),
      }),
      z.object({
        type: z.literal("agent"),
        agentId: z.string(),
        displayName: z.string(),
      }),
    ]),
    content: z.string(),
    sourceRunId: z.string().optional(),
  }),
);

export const postReplyCreatedEvent = createEventDefinition(
  "post-reply-created",
  z.object({
    replyId: z.string(),
    workspaceId: z.string(),
    parentPostId: z.string(),
    author: z.discriminatedUnion("type", [
      z.object({
        type: z.literal("user"),
        userId: z.string().optional(),
        displayName: z.string(),
      }),
      z.object({
        type: z.literal("agent"),
        agentId: z.string(),
        displayName: z.string(),
      }),
    ]),
    content: z.string(),
    sourceRunId: z.string().optional(),
  }),
);

export const workspaceFilesystemInitializedEvent = createEventDefinition(
  "workspace-filesystem-initialized",
  z.object({
    workspaceId: z.string(),
  }),
);

export const workspaceFilesystemScanRequestedEvent = createEventDefinition(
  "workspace-filesystem-scan-requested",
  z.object({
    scanId: z.string(),
    workspaceId: z.string(),
    reason: z.enum(["workspaceCreated", "userRequested", "agentToolChanged"]),
    requestedBy: z.discriminatedUnion("type", [
      z.object({
        type: z.literal("user"),
        userId: z.string().optional(),
        displayName: z.string(),
      }),
      z.object({
        type: z.literal("agent"),
        agentId: z.string(),
        displayName: z.string(),
      }),
      z.object({
        type: z.literal("system"),
      }),
    ]),
  }),
);

export const workspaceFilesystemScanStartedEvent = createEventDefinition(
  "workspace-filesystem-scan-started",
  z.object({
    scanId: z.string(),
    workspaceId: z.string(),
  }),
);

export const workspaceFilesystemScanCompletedEvent = createEventDefinition(
  "workspace-filesystem-scan-completed",
  z.object({
    scanId: z.string(),
    workspaceId: z.string(),
    discoveredNodeCount: z.number().int().nonnegative(),
    changedNodeCount: z.number().int().nonnegative(),
    deletedNodeCount: z.number().int().nonnegative(),
  }),
);

export const workspaceFilesystemScanFailedEvent = createEventDefinition(
  "workspace-filesystem-scan-failed",
  z.object({
    scanId: z.string(),
    workspaceId: z.string(),
    error: z.string(),
  }),
);

export const filesystemNodeDiscoveredEvent = createEventDefinition(
  "filesystem-node-discovered",
  z.object({
    scanId: z.string(),
    workspaceId: z.string(),
    path: z.string(),
    parentPath: z.string().nullable(),
    name: z.string(),
    kind: z.enum(["file", "directory"]),
    sizeBytes: z.number().int().nonnegative().nullable(),
    modifiedAt: z.string().optional(),
  }),
);

export const filesystemNodeChangedEvent = createEventDefinition(
  "filesystem-node-changed",
  z.object({
    scanId: z.string(),
    workspaceId: z.string(),
    path: z.string(),
    parentPath: z.string().nullable(),
    name: z.string(),
    kind: z.enum(["file", "directory"]),
    sizeBytes: z.number().int().nonnegative().nullable(),
    modifiedAt: z.string().optional(),
  }),
);

export const filesystemNodeDeletedEvent = createEventDefinition(
  "filesystem-node-deleted",
  z.object({
    scanId: z.string(),
    workspaceId: z.string(),
    path: z.string(),
  }),
);

export const agentRunRequestedEvent = createEventDefinition(
  "agent-run-requested",
  z.object({
    runId: z.string(),
    workspaceId: z.string(),
    postId: z.string().optional(),
    agentId: z.string(),
    agentName: z.string(),
    requestedBy: z.discriminatedUnion("type", [
      z.object({
        type: z.literal("user"),
        userId: z.string().optional(),
        displayName: z.string(),
      }),
      z.object({
        type: z.literal("agent"),
        agentId: z.string(),
        displayName: z.string(),
      }),
      z.object({
        type: z.literal("system"),
      }),
    ]),
  }),
);

export const agentRunStartedEvent = createEventDefinition(
  "agent-run-started",
  z.object({
    runId: z.string(),
    workspaceId: z.string(),
    agentId: z.string(),
  }),
);

export const agentRunStreamedEvent = createEventDefinition(
  "agent-run-streamed",
  z.object({
    runId: z.string(),
    workspaceId: z.string(),
    agentId: z.string(),
    chunkId: z.string(),
    sequence: z.number().int().nonnegative(),
    delta: z.string(),
  }),
);

export const agentRunCompletedEvent = createEventDefinition(
  "agent-run-completed",
  z.object({
    runId: z.string(),
    workspaceId: z.string(),
    agentId: z.string(),
  }),
);

export const agentRunFailedEvent = createEventDefinition(
  "agent-run-failed",
  z.object({
    runId: z.string(),
    workspaceId: z.string(),
    agentId: z.string(),
    error: z.string(),
  }),
);

export const toolCallStartedEvent = createEventDefinition(
  "tool-call-started",
  z.object({
    toolCallId: z.string(),
    runId: z.string(),
    workspaceId: z.string(),
    agentId: z.string(),
    toolName: z.string(),
    inputSummary: z.string().optional(),
  }),
);

export const toolCallCompletedEvent = createEventDefinition(
  "tool-call-completed",
  z.object({
    toolCallId: z.string(),
    runId: z.string(),
    workspaceId: z.string(),
    agentId: z.string(),
    toolName: z.string(),
    outputSummary: z.string().optional(),
  }),
);

export const toolCallFailedEvent = createEventDefinition(
  "tool-call-failed",
  z.object({
    toolCallId: z.string(),
    runId: z.string(),
    workspaceId: z.string(),
    agentId: z.string(),
    toolName: z.string(),
    error: z.string(),
  }),
);

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
] as const;
